import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../../src/Infrastructure/Database/connection";
import { DrizzleAuditLogRepository } from "../../src/Infrastructure/Repositories/DrizzleAuditLogRepository";
import { DrizzleMemberRepository } from "../../src/Infrastructure/Repositories/DrizzleMemberRepository";
import { setupTestDatabase, truncateAll } from "./helpers/testDatabase";

let connection: DatabaseConnection;
let repository: DrizzleAuditLogRepository;
let members: DrizzleMemberRepository;

beforeAll(async () => {
    connection = await setupTestDatabase();
    repository = new DrizzleAuditLogRepository(connection.db);
    members = new DrizzleMemberRepository(connection.db);
});

afterAll(async () => {
    await connection.close();
});

beforeEach(async () => {
    await truncateAll(connection);
});

describe("DrizzleAuditLogRepository", () => {
    it("writes an entry and reads it back whole", async () => {
        await repository.record({
            actorEmail: "boss@example.com",
            action: "tag.granted",
            targetEmail: "someone@example.com",
            details: { tag: "editor", createdTag: false },
        });

        const [entry] = await repository.listRecent(10);

        expect(entry).toMatchObject({
            actorEmail: "boss@example.com",
            action: "tag.granted",
            targetEmail: "someone@example.com",
            details: { tag: "editor", createdTag: false },
        });
        expect(entry?.createdAt).toBeInstanceOf(Date);
    });

    it("normalises both emails, so one person is one person", async () => {
        await repository.record({
            actorEmail: "Boss@Example.COM",
            action: "tag.granted",
            targetEmail: "Someone@Example.COM",
            details: {},
        });

        const [entry] = await repository.listForTarget("someone@example.com", 10);

        expect(entry?.actorEmail).toBe("boss@example.com");
        expect(entry?.targetEmail).toBe("someone@example.com");
    });

    it("answers newest first", async () => {
        for (const tag of ["first", "second", "third"]) {
            // Sequential on purpose: the ordering under test is the order these were written in.
            // eslint-disable-next-line no-await-in-loop
            await repository.record({
                actorEmail: "boss@example.com",
                action: "tag.granted",
                targetEmail: "someone@example.com",
                details: { tag },
            });
        }

        const entries = await repository.listRecent(10);

        expect(entries.map((entry) => entry.details.tag)).toEqual(["third", "second", "first"]);
    });

    it("honours the limit", async () => {
        for (const tag of ["a", "b", "c"]) {
            // eslint-disable-next-line no-await-in-loop
            await repository.record({
                actorEmail: "boss@example.com",
                action: "tag.granted",
                targetEmail: "someone@example.com",
                details: { tag },
            });
        }

        expect(await repository.listRecent(2)).toHaveLength(2);
    });

    it("narrows to one target", async () => {
        await repository.record({
            actorEmail: "boss@example.com",
            action: "tag.granted",
            targetEmail: "alice@example.com",
            details: {},
        });
        await repository.record({
            actorEmail: "boss@example.com",
            action: "tag.granted",
            targetEmail: "bob@example.com",
            details: {},
        });

        const entries = await repository.listForTarget("alice@example.com", 10);

        expect(entries).toHaveLength(1);
        expect(entries[0]?.targetEmail).toBe("alice@example.com");
    });

    it("survives the member it names being deleted", async () => {
        // The reason `audit_log` has no foreign keys. A reference would cascade the history away, and a log that
        // disappears with the thing it describes is not evidence of anything.
        const member = await members.ensureMember("leaver@example.com");
        await repository.record({
            actorEmail: "leaver@example.com",
            action: "tag.granted",
            targetEmail: "someone@example.com",
            details: { tag: "editor" },
        });

        await connection.sql`delete from "member" where "id" = ${member.id}`;

        const entries = await repository.listRecent(10);

        expect(entries).toHaveLength(1);
        expect(entries[0]?.actorEmail).toBe("leaver@example.com");
    });

    it("keeps an entry unchanged when the member it names is renamed", async () => {
        // The other half of the same rule: the log records who someone was at the time, not who they are now.
        await members.ensureMember("old.address@example.com");
        await repository.record({
            actorEmail: "boss@example.com",
            action: "member.renamed",
            targetEmail: "old.address@example.com",
            details: { username: "Before" },
        });

        await connection.sql`update "member" set "email" = 'new.address@example.com' where "email" = 'old.address@example.com'`;

        expect((await repository.listRecent(10))[0]?.targetEmail).toBe("old.address@example.com");
    });

    it("stores an empty details object rather than null", async () => {
        await repository.record({
            actorEmail: "boss@example.com",
            action: "tag.revoked",
            targetEmail: "someone@example.com",
            details: {},
        });

        expect((await repository.listRecent(10))[0]?.details).toEqual({});
    });
});

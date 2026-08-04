import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../../src/Infrastructure/Database/connection";
import { DrizzleMemberRepository } from "../../src/Infrastructure/Repositories/DrizzleMemberRepository";
import { DrizzleReportRepository } from "../../src/Infrastructure/Repositories/DrizzleReportRepository";
import { setupTestDatabase, truncateAll } from "./helpers/testDatabase";

let connection: DatabaseConnection;
let repository: DrizzleReportRepository;
let members: DrizzleMemberRepository;

const report = (overrides: Partial<Parameters<DrizzleReportRepository["record"]>[0]> = {}) => ({
    reportedIdentifier: "troublemaker@example.com",
    reporterIdentifier: "alice@example.com",
    comment: "Kept shouting in the meeting room",
    roomUrl: "/~/maps/office.wam",
    ...overrides,
});

beforeAll(async () => {
    connection = await setupTestDatabase();
    repository = new DrizzleReportRepository(connection.db);
    members = new DrizzleMemberRepository(connection.db);
});

afterAll(async () => {
    await connection.close();
});

beforeEach(async () => {
    await truncateAll(connection);
});

describe("DrizzleReportRepository", () => {
    it("writes a report and reads it back whole", async () => {
        const written = await repository.record(report());

        expect(written).toMatchObject({
            reportedIdentifier: "troublemaker@example.com",
            reporterIdentifier: "alice@example.com",
            comment: "Kept shouting in the meeting room",
            roomUrl: "/~/maps/office.wam",
        });
        expect(written.createdAt).toBeInstanceOf(Date);
        expect(await repository.listRecent(10)).toHaveLength(1);
    });

    it("normalises both identifiers, so every report about one person is found together", async () => {
        await repository.record(
            report({ reportedIdentifier: "Trouble.Maker@Example.COM", reporterIdentifier: "Alice@Example.COM" }),
        );

        expect((await repository.listRecent(10))[0]).toMatchObject({
            reportedIdentifier: "trouble.maker@example.com",
            reporterIdentifier: "alice@example.com",
        });
    });

    it("keeps a long comment verbatim", async () => {
        // A `text` column, not a bounded one: truncating somebody's account of what happened to fit a limit we
        // invented would destroy the only thing the record is for.
        const comment = "They ".repeat(2000).trim();

        await repository.record(report({ comment }));

        expect((await repository.listRecent(10))[0]?.comment).toBe(comment);
    });

    it("lists newest first and honours the limit", async () => {
        for (const comment of ["first", "second", "third"]) {
            // Sequential on purpose: the ordering under test is the order these were written in.
            // eslint-disable-next-line no-await-in-loop
            await repository.record(report({ comment }));
        }

        expect((await repository.listRecent(10)).map((entry) => entry.comment)).toEqual(["third", "second", "first"]);
        expect(await repository.listRecent(2)).toHaveLength(2);
    });

    it("survives both people it names being deleted", async () => {
        // The reason `report` has no foreign keys. A cascade would erase the complaint along with the account it was
        // about, which is precisely when somebody wants to read it.
        const reported = await members.ensureMember("troublemaker@example.com");
        const reporter = await members.ensureMember("alice@example.com");
        await repository.record(report());

        await connection.sql`delete from "member" where "id" in (${reported.id}, ${reporter.id})`;

        expect((await repository.listRecent(10))[0]).toMatchObject({
            reportedIdentifier: "troublemaker@example.com",
            reporterIdentifier: "alice@example.com",
        });
    });

    it("stores a report from an anonymous visitor, who is not a member at all", async () => {
        await repository.record(report({ reporterIdentifier: "998ce839-3dea-4698-8b41-ebbdf7688ad9" }));

        expect((await repository.listRecent(10))[0]?.reporterIdentifier).toBe("998ce839-3dea-4698-8b41-ebbdf7688ad9");
    });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../../src/Infrastructure/Database/connection";
import { DrizzleBanRepository } from "../../src/Infrastructure/Repositories/DrizzleBanRepository";
import { DrizzleMemberRepository } from "../../src/Infrastructure/Repositories/DrizzleMemberRepository";
import { setupTestDatabase, truncateAll } from "./helpers/testDatabase";

let connection: DatabaseConnection;
let repository: DrizzleBanRepository;
let members: DrizzleMemberRepository;

const ban = (overrides: Partial<Parameters<DrizzleBanRepository["record"]>[0]> = {}) => ({
    identifier: "troublemaker@example.com",
    displayName: "Trouble Maker",
    message: "You have been banned by an admin",
    roomUrl: "/~/maps/office.wam",
    issuedBy: "boss@example.com",
    ...overrides,
});

beforeAll(async () => {
    connection = await setupTestDatabase();
    repository = new DrizzleBanRepository(connection.db);
    members = new DrizzleMemberRepository(connection.db);
});

afterAll(async () => {
    await connection.close();
});

beforeEach(async () => {
    await truncateAll(connection);
});

describe("DrizzleBanRepository", () => {
    it("writes a ban and reads it back whole", async () => {
        const written = await repository.record(ban());

        expect(written).toMatchObject({
            identifier: "troublemaker@example.com",
            displayName: "Trouble Maker",
            message: "You have been banned by an admin",
            roomUrl: "/~/maps/office.wam",
            issuedBy: "boss@example.com",
        });
        expect(written.createdAt).toBeInstanceOf(Date);
        expect(await repository.findActive("troublemaker@example.com")).toMatchObject({ id: written.id });
    });

    it("normalises both identifiers, so one person is one person", async () => {
        await repository.record(ban({ identifier: "Trouble.Maker@Example.COM", issuedBy: "Boss@Example.COM" }));

        const found = await repository.findActive("trouble.maker@example.com");

        expect(found?.identifier).toBe("trouble.maker@example.com");
        expect(found?.issuedBy).toBe("boss@example.com");
    });

    it("answers undefined for somebody nobody ever banned", async () => {
        // Not an error: `GET /api/ban` answers `is_banned: false` for everyone it has never heard of, which is every
        // user on every connection.
        expect(await repository.findActive("never-seen-before@example.com")).toBeUndefined();
    });

    it("answers with the most recent ban when somebody was banned twice", async () => {
        await repository.record(ban({ message: "First offence" }));
        await repository.record(ban({ message: "Second offence" }));

        expect((await repository.findActive("troublemaker@example.com"))?.message).toBe("Second offence");
    });

    it("stores no display name when the pusher sent none", async () => {
        await repository.record(ban({ displayName: null }));

        expect((await repository.findActive("troublemaker@example.com"))?.displayName).toBeNull();
    });

    it("lists newest first and honours the limit", async () => {
        for (const identifier of ["first@example.com", "second@example.com", "third@example.com"]) {
            // Sequential on purpose: the ordering under test is the order these were written in.
            // eslint-disable-next-line no-await-in-loop
            await repository.record(ban({ identifier }));
        }

        expect((await repository.listRecent(10)).map((entry) => entry.identifier)).toEqual([
            "third@example.com",
            "second@example.com",
            "first@example.com",
        ]);
        expect(await repository.listRecent(2)).toHaveLength(2);
    });

    it("survives the member it names being deleted", async () => {
        // The reason `ban` has no foreign keys. A cascade would mean deleting an account lifts its ban, which is
        // exactly backwards.
        const member = await members.ensureMember("troublemaker@example.com");
        await repository.record(ban());

        await connection.sql`delete from "member" where "id" = ${member.id}`;

        expect(await repository.findActive("troublemaker@example.com")).toMatchObject({ message: ban().message });
    });

    it("bans somebody who is not a member at all", async () => {
        // An anonymous visitor reaches the pusher with a uuid rather than an email. A foreign key would force them to
        // become an account nobody can ever log into.
        await repository.record(ban({ identifier: "998ce839-3dea-4698-8b41-ebbdf7688ad9", displayName: null }));

        expect(await repository.findActive("998ce839-3dea-4698-8b41-ebbdf7688ad9")).toMatchObject({
            identifier: "998ce839-3dea-4698-8b41-ebbdf7688ad9",
        });
    });

    it("keeps no column for an ip address", async () => {
        // Decision #3, asserted against the real schema rather than against our own writer: an IP address is personal
        // data with a retention obligation attached, and the way to be sure it is not stored is for there to be
        // nowhere to store it.
        const columns = await connection.sql<{ column_name: string }[]>`
            select column_name from information_schema.columns where table_name = 'ban'
        `;

        expect(columns.map((column) => column.column_name)).not.toContain("ip_address");
        expect(columns.map((column) => column.column_name).join(",")).not.toContain("ip");
    });
});

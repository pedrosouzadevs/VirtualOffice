import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../../src/Infrastructure/Database/connection";
import { DrizzleMemberRepository } from "../../src/Infrastructure/Repositories/DrizzleMemberRepository";
import { setupTestDatabase, truncateAll } from "./helpers/testDatabase";

let connection: DatabaseConnection;
let repository: DrizzleMemberRepository;

beforeAll(async () => {
    connection = await setupTestDatabase();
    repository = new DrizzleMemberRepository(connection.db);
});

afterAll(async () => {
    await connection.close();
});

beforeEach(async () => {
    await truncateAll(connection);
});

describe("DrizzleMemberRepository", () => {
    describe("findByEmail", () => {
        it("returns undefined for someone we have never seen", async () => {
            expect(await repository.findByEmail("nobody@example.com")).toBeUndefined();
        });

        it("returns a member with no tags as an empty array, not as a missing member", async () => {
            await repository.ensureMember("plain@example.com");

            const found = await repository.findByEmail("plain@example.com");

            expect(found).toMatchObject({ email: "plain@example.com", tags: [] });
        });

        it("returns every tag the member holds", async () => {
            const created = await repository.ensureMember("tagged@example.com");
            const admin = await repository.ensureTag("admin");
            const editor = await repository.ensureTag("editor");
            await repository.grantTag(created.id, admin.id);
            await repository.grantTag(created.id, editor.id);

            const found = await repository.findByEmail("tagged@example.com");

            expect(found?.tags.slice().sort()).toEqual(["admin", "editor"]);
        });

        it("matches regardless of casing, since the identity provider chooses it and we do not", async () => {
            await repository.ensureMember("Mixed.Case@Example.COM");

            const found = await repository.findByEmail("mixed.case@example.com");

            expect(found?.email).toBe("mixed.case@example.com");
        });
    });

    describe("ensureMember", () => {
        it("is idempotent: the same email never produces a second member", async () => {
            const first = await repository.ensureMember("same@example.com");
            const second = await repository.ensureMember("same@example.com");

            expect(second.id).toBe(first.id);

            const rows = await connection.sql`select count(*)::int as count from "member"`;
            expect(rows[0]?.count).toBe(1);
        });

        it("does not overwrite a username already stored", async () => {
            await repository.ensureMember("keep@example.com", "Original");

            const second = await repository.ensureMember("keep@example.com", "Overwritten");

            expect(second.username).toBe("Original");
        });

        it("treats two casings of one address as the same person", async () => {
            const first = await repository.ensureMember("dup@example.com");
            const second = await repository.ensureMember("DUP@EXAMPLE.COM");

            expect(second.id).toBe(first.id);
        });
    });

    describe("ensureTag", () => {
        it("is idempotent", async () => {
            const first = await repository.ensureTag("admin");
            const second = await repository.ensureTag("admin");

            expect(second.id).toBe(first.id);
        });
    });

    describe("grantTag", () => {
        it("is idempotent: granting the same tag twice is not an error", async () => {
            const created = await repository.ensureMember("grant@example.com");
            const admin = await repository.ensureTag("admin");

            await repository.grantTag(created.id, admin.id);
            await repository.grantTag(created.id, admin.id);

            const found = await repository.findByEmail("grant@example.com");
            expect(found?.tags).toEqual(["admin"]);
        });
    });

    describe("search", () => {
        it("matches a fragment of the email, case-insensitively", async () => {
            await repository.ensureMember("Alice.Smith@Example.com");

            expect((await repository.search("ALICE", 20)).map((m) => m.email)).toEqual(["alice.smith@example.com"]);
            expect((await repository.search("smith", 20)).map((m) => m.email)).toEqual(["alice.smith@example.com"]);
        });

        it("matches the username too, so the picker finds people by name once names exist", async () => {
            await repository.ensureMember("someone@example.com", "Roberta");

            expect((await repository.search("robe", 20)).map((m) => m.email)).toEqual(["someone@example.com"]);
        });

        it("returns nothing for an empty search rather than the whole table", async () => {
            await repository.ensureMember("alice@example.com");

            expect(await repository.search("", 20)).toEqual([]);
            expect(await repository.search("   ", 20)).toEqual([]);
        });

        it("honours the limit, because the picker renders every result", async () => {
            await repository.ensureMember("aaa@example.com");
            await repository.ensureMember("aab@example.com");
            await repository.ensureMember("aac@example.com");

            expect(await repository.search("example.com", 2)).toHaveLength(2);
        });

        it("orders by email so the dropdown does not reshuffle between keystrokes", async () => {
            await repository.ensureMember("carol@example.com");
            await repository.ensureMember("alice@example.com");
            await repository.ensureMember("bob@example.com");

            expect((await repository.search("example.com", 20)).map((m) => m.email)).toEqual([
                "alice@example.com",
                "bob@example.com",
                "carol@example.com",
            ]);
        });

        it("treats LIKE wildcards as literal characters", async () => {
            // Without escaping, searching "%" would match everyone and "_" would match any single character.
            await repository.ensureMember("alice@example.com");
            await repository.ensureMember("bob%percent@example.com");
            await repository.ensureMember("carol_underscore@example.com");

            expect((await repository.search("%", 20)).map((m) => m.email)).toEqual(["bob%percent@example.com"]);
            expect((await repository.search("l_u", 20)).map((m) => m.email)).toEqual(["carol_underscore@example.com"]);
        });

        it("returns members with no tags: MemberData carries none, so the join is not paid for", async () => {
            await repository.ensureMember("plain@example.com");

            const found = await repository.search("plain", 20);

            expect(found[0]).toMatchObject({ email: "plain@example.com", username: null });
            expect(found[0]).not.toHaveProperty("tags");
        });
    });

    describe("referential integrity", () => {
        it("drops a member's grants when the member is deleted, leaving no dangling rows", async () => {
            const created = await repository.ensureMember("gone@example.com");
            const admin = await repository.ensureTag("admin");
            await repository.grantTag(created.id, admin.id);

            await connection.sql`delete from "member" where id = ${created.id}`;

            const rows = await connection.sql`select count(*)::int as count from "member_tag"`;
            expect(rows[0]?.count).toBe(0);
        });

        it("keeps tags and members independent: deleting a tag does not delete its holders", async () => {
            const created = await repository.ensureMember("survivor@example.com");
            const admin = await repository.ensureTag("admin");
            await repository.grantTag(created.id, admin.id);

            await connection.sql`delete from "tag" where id = ${admin.id}`;

            const found = await repository.findByEmail("survivor@example.com");
            expect(found).toMatchObject({ email: "survivor@example.com", tags: [] });
        });

        it("keeps the internal id stable across an email change, which is why nothing references the email", async () => {
            // ADR-0002 decision #5: foreign keys point at the internal id precisely so this is a one-column update.
            const created = await repository.ensureMember("old@example.com");
            const admin = await repository.ensureTag("admin");
            await repository.grantTag(created.id, admin.id);

            await connection.sql`update "member" set email = 'new@example.com' where id = ${created.id}`;

            const found = await repository.findByEmail("new@example.com");
            expect(found?.id).toBe(created.id);
            expect(found?.tags).toEqual(["admin"]);
        });
    });
});

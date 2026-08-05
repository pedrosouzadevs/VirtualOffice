import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrapAdmin } from "../../src/Application/BootstrapAdminService";
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

describe("bootstrapAdmin", () => {
    it("creates the admin and editor tags", async () => {
        const result = await bootstrapAdmin(repository, undefined);

        expect(result.ensuredTags.slice().sort()).toEqual(["admin", "editor"]);
    });

    it("grants the admin tag to the configured email", async () => {
        await bootstrapAdmin(repository, "boss@example.com");

        const found = await repository.findByEmail("boss@example.com");
        expect(found?.tags).toEqual(["admin"]);
    });

    it("normalises the configured email, so casing in the .env cannot create a second member", async () => {
        await bootstrapAdmin(repository, "Boss@Example.COM");

        const found = await repository.findByEmail("boss@example.com");
        expect(found?.tags).toEqual(["admin"]);
    });

    it("is idempotent across restarts, which is what lets it run unconditionally at boot", async () => {
        await bootstrapAdmin(repository, "boss@example.com");
        await bootstrapAdmin(repository, "boss@example.com");
        await bootstrapAdmin(repository, "boss@example.com");

        const members = await connection.sql`select count(*)::int as count from "member"`;
        const tags = await connection.sql`select count(*)::int as count from "tag"`;
        const grants = await connection.sql`select count(*)::int as count from "member_tag"`;

        expect(members[0]?.count).toBe(1);
        expect(tags[0]?.count).toBe(2);
        expect(grants[0]?.count).toBe(1);
    });

    it("starts without an administrator when no email is configured, rather than refusing to boot", async () => {
        const result = await bootstrapAdmin(repository, undefined);

        expect(result.adminEmail).toBeUndefined();
        const members = await connection.sql`select count(*)::int as count from "member"`;
        expect(members[0]?.count).toBe(0);
    });

    it("treats an empty string like an unset variable, because Compose interpolates unset vars to ''", async () => {
        const result = await bootstrapAdmin(repository, "");

        expect(result.adminEmail).toBeUndefined();
        const members = await connection.sql`select count(*)::int as count from "member"`;
        expect(members[0]?.count).toBe(0);
    });

    it("leaves tags a member already had untouched", async () => {
        const existing = await repository.ensureMember("boss@example.com");
        const editor = await repository.ensureTag("editor");
        await repository.grantTag(existing.id, editor.id);

        await bootstrapAdmin(repository, "boss@example.com");

        const found = await repository.findByEmail("boss@example.com");
        expect(found?.tags.slice().sort()).toEqual(["admin", "editor"]);
    });
});

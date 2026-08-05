import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseConnection } from "../../src/Infrastructure/Database/connection";
import { DrizzleMemberRepository } from "../../src/Infrastructure/Repositories/DrizzleMemberRepository";
import { DrizzleTagRepository } from "../../src/Infrastructure/Repositories/DrizzleTagRepository";
import { setupTestDatabase, truncateAll } from "./helpers/testDatabase";

let connection: DatabaseConnection;
let tags: DrizzleTagRepository;
let members: DrizzleMemberRepository;

beforeAll(async () => {
    connection = await setupTestDatabase();
    tags = new DrizzleTagRepository(connection.db);
    members = new DrizzleMemberRepository(connection.db);
});

afterAll(async () => {
    await connection.close();
});

beforeEach(async () => {
    await truncateAll(connection);
});

describe("DrizzleTagRepository", () => {
    describe("listAll", () => {
        it("returns nothing on an empty catalogue", async () => {
            expect(await tags.listAll()).toEqual([]);
        });

        it("returns every tag ordered by name", async () => {
            await members.ensureTag("editor");
            await members.ensureTag("admin");

            expect(await tags.listAll()).toEqual(["admin", "editor"]);
        });
    });

    describe("search", () => {
        it("matches a fragment, case-insensitively", async () => {
            await members.ensureTag("admin");
            await members.ensureTag("editor");

            expect(await tags.search("EDIT", 100)).toEqual(["editor"]);
            expect(await tags.search("min", 100)).toEqual(["admin"]);
        });

        it("returns every tag for an empty search, because the pickers open with a list", async () => {
            await members.ensureTag("admin");
            await members.ensureTag("editor");

            expect(await tags.search("", 100)).toEqual(["admin", "editor"]);
            expect(await tags.search("   ", 100)).toEqual(["admin", "editor"]);
        });

        it("honours the limit", async () => {
            await members.ensureTag("admin");
            await members.ensureTag("editor");

            expect(await tags.search("", 1)).toHaveLength(1);
        });

        it("orders results by name, not by insertion", async () => {
            await members.ensureTag("zulu-team");
            await members.ensureTag("alpha-team");

            expect(await tags.search("team", 100)).toEqual(["alpha-team", "zulu-team"]);
        });

        it("treats LIKE wildcards as literal characters", async () => {
            await members.ensureTag("admin");
            await members.ensureTag("odd%tag");

            expect(await tags.search("%", 100)).toEqual(["odd%tag"]);
        });

        it("returns an empty array when nothing matches", async () => {
            await members.ensureTag("admin");

            expect(await tags.search("nope", 100)).toEqual([]);
        });
    });
});

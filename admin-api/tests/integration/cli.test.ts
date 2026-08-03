import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    grantTag,
    listAudit,
    listMembers,
    listTags,
    revokeTag,
    setMemberName,
    type CommandContext,
} from "../../src/Cli/commands";
import type { DatabaseConnection } from "../../src/Infrastructure/Database/connection";
import { LoggingAdminAlerter } from "../../src/Infrastructure/Alerting/LoggingAdminAlerter";
import { DrizzleAuditLogRepository } from "../../src/Infrastructure/Repositories/DrizzleAuditLogRepository";
import { DrizzleMemberRepository } from "../../src/Infrastructure/Repositories/DrizzleMemberRepository";
import { DrizzleTagRepository } from "../../src/Infrastructure/Repositories/DrizzleTagRepository";
import { setupTestDatabase, truncateAll } from "./helpers/testDatabase";

let connection: DatabaseConnection;
let context: CommandContext;
let output: string[];

beforeAll(async () => {
    connection = await setupTestDatabase();
});

afterAll(async () => {
    await connection.close();
});

beforeEach(async () => {
    await truncateAll(connection);
    output = [];
    context = {
        members: new DrizzleMemberRepository(connection.db),
        tags: new DrizzleTagRepository(connection.db),
        audit: new DrizzleAuditLogRepository(connection.db),
        // Real, so a refused `admin` grant is proven to alert rather than merely to fail. Its webhook is unset, so
        // it only writes to the log.
        alerter: new LoggingAdminAlerter(undefined),
        out: (line) => output.push(line),
    };
});

const printed = () => output.join("\n");

/**
 * Grants `admin` the only way anything is allowed to: straight through the repository, which is what direct SQL and
 * the idempotent bootstrap both amount to.
 *
 * The CLI cannot do this any more (threat model, F1), so a test that needs an administrator has to set one up the
 * way the world really does.
 */
async function grantAdminDirectly(email: string): Promise<void> {
    const member = await context.members.ensureMember(email);
    const tag = await context.members.ensureTag("admin");

    await context.members.grantTag(member.id, tag.id);
}

/**
 * The CLI is exercised against a real Postgres rather than stubs: what these commands promise is idempotence, and
 * that promise lives in ON CONFLICT DO NOTHING and in a DELETE that matches nothing — neither of which a fake proves.
 */
describe("member:grant", () => {
    it("creates the member and the tag when both are new", async () => {
        const result = await grantTag(context, "alice@example.com", "editor");

        expect(result.exitCode).toBe(0);
        expect(await context.members.findByEmail("alice@example.com")).toMatchObject({ tags: ["editor"] });
    });

    it("is idempotent: granting twice leaves one grant and succeeds both times", async () => {
        await grantTag(context, "alice@example.com", "editor");
        const second = await grantTag(context, "alice@example.com", "editor");

        expect(second.exitCode).toBe(0);
        const rows = await connection.sql`select count(*)::int as count from "member_tag"`;
        expect(rows[0]?.count).toBe(1);
    });

    it("warns when it invents a tag, so a typo is visible immediately", async () => {
        await grantTag(context, "alice@example.com", "editor");
        output = [];

        await grantTag(context, "alice@example.com", "editr");

        expect(printed()).toContain('the tag "editr" did not exist and was created');
        expect(printed()).toContain("Existing tags: editor");
    });

    it("says nothing about creation when the tag already exists", async () => {
        await context.members.ensureTag("editor");
        output = [];

        await grantTag(context, "alice@example.com", "editor");

        expect(printed()).not.toContain("did not exist");
    });

    it("normalises the email, so casing cannot create a second member", async () => {
        await grantTag(context, "Alice@Example.com", "editor");
        await grantTag(context, "alice@example.com", "admin");

        const rows = await connection.sql`select count(*)::int as count from "member"`;
        expect(rows[0]?.count).toBe(1);
    });

    it("rejects a missing argument rather than acting on an empty value", async () => {
        expect((await grantTag(context, "", "editor")).exitCode).toBe(1);
        expect((await grantTag(context, "alice@example.com", "")).exitCode).toBe(1);
    });
});

describe("member:revoke", () => {
    it("removes the grant", async () => {
        await grantTag(context, "alice@example.com", "editor");
        output = [];

        const result = await revokeTag(context, "alice@example.com", "editor");

        expect(result.exitCode).toBe(0);
        expect(await context.members.findByEmail("alice@example.com")).toMatchObject({ tags: [] });
    });

    it("is idempotent: revoking twice succeeds and says so the second time", async () => {
        await grantTag(context, "alice@example.com", "editor");
        await revokeTag(context, "alice@example.com", "editor");
        output = [];

        const second = await revokeTag(context, "alice@example.com", "editor");

        expect(second.exitCode).toBe(0);
        expect(printed()).toContain('did not hold "editor"');
    });

    it("does not delete the tag itself, only the grant", async () => {
        await grantTag(context, "alice@example.com", "editor");
        await revokeTag(context, "alice@example.com", "editor");

        expect(await context.tags.listAll()).toContain("editor");
    });

    it("fails on an unknown member", async () => {
        await context.members.ensureTag("editor");

        const result = await revokeTag(context, "nobody@example.com", "editor");

        expect(result.exitCode).toBe(1);
        expect(printed()).toContain("No member with email");
    });

    it("fails on an unknown tag instead of creating it", async () => {
        await grantTag(context, "alice@example.com", "editor");
        output = [];

        const result = await revokeTag(context, "alice@example.com", "nonexistent");

        expect(result.exitCode).toBe(1);
        expect(await context.tags.listAll()).not.toContain("nonexistent");
    });
});

describe("member:set-name", () => {
    it("sets the name shown by the member picker", async () => {
        await grantTag(context, "alice@example.com", "editor");
        output = [];

        const result = await setMemberName(context, "alice@example.com", "Alice Smith");

        expect(result.exitCode).toBe(0);
        expect(await context.members.findByEmail("alice@example.com")).toMatchObject({ username: "Alice Smith" });
    });

    it("clears the name when given an empty one", async () => {
        await grantTag(context, "alice@example.com", "editor");
        await setMemberName(context, "alice@example.com", "Alice");

        await setMemberName(context, "alice@example.com", "");

        expect(await context.members.findByEmail("alice@example.com")).toMatchObject({ username: null });
    });

    it("refuses an unknown member rather than creating a ghost account from a typo", async () => {
        const result = await setMemberName(context, "nobody@example.com", "Nobody");

        expect(result.exitCode).toBe(1);
        const rows = await connection.sql`select count(*)::int as count from "member"`;
        expect(rows[0]?.count).toBe(0);
    });

    it("is idempotent: setting the same name twice succeeds", async () => {
        await grantTag(context, "alice@example.com", "editor");
        await setMemberName(context, "alice@example.com", "Alice");

        expect((await setMemberName(context, "alice@example.com", "Alice")).exitCode).toBe(0);
    });
});

describe("member:list and tag:list", () => {
    it("say so plainly when there is nothing to show", async () => {
        expect((await listMembers(context)).exitCode).toBe(0);
        expect(printed()).toContain("No members yet.");

        output = [];
        expect((await listTags(context)).exitCode).toBe(0);
        expect(printed()).toContain("No tags yet.");
    });

    it("lists members with their tags, and a member with none", async () => {
        await grantTag(context, "alice@example.com", "editor");
        await grantAdminDirectly("alice@example.com");
        await context.members.ensureMember("bob@example.com");
        output = [];

        await listMembers(context);

        expect(printed()).toContain("alice@example.com");
        expect(printed()).toContain("admin, editor");
        expect(printed()).toContain("bob@example.com");
        expect(printed()).toContain("2 member(s).");
    });

    it("keeps a member's tags together instead of truncating them under the limit", async () => {
        // The limit applies to members, not to joined rows: applying it to the join would cut a member's tag list.
        await grantTag(context, "alice@example.com", "editor");
        await grantAdminDirectly("alice@example.com");

        const listed = await context.members.listAll(1);

        expect(listed).toHaveLength(1);
        expect(listed[0]?.tags.slice().sort()).toEqual(["admin", "editor"]);
    });

    it("lists the tag catalogue", async () => {
        await grantTag(context, "alice@example.com", "editor");
        await grantAdminDirectly("alice@example.com");
        output = [];

        await listTags(context);

        expect(printed()).toBe("admin\neditor");
    });

    describe("the admin tag", () => {
        it("cannot be granted from the terminal either, and prints the SQL that can", async () => {
            // The rule is about where the privilege lives, not about which surface asked. The CLI runs inside the
            // container and is still refused (threat model, F1).
            const result = await grantTag(context, "alice@example.com", "admin");

            expect(result.exitCode).toBe(1);
            expect(printed()).toContain("cannot be granted from here");
            expect(printed()).toContain("insert into member_tag");
            expect(printed()).toContain("alice@example.com");
        });

        it("leaves the database untouched when refused", async () => {
            await grantTag(context, "alice@example.com", "admin");

            // Not even the member is created: the refusal happens before any write.
            expect(await context.members.findByEmail("alice@example.com")).toBeUndefined();
        });

        it("records the refused attempt", async () => {
            await grantTag(context, "alice@example.com", "admin");
            output = [];

            await listAudit(context, undefined);

            expect(printed()).toContain("tag.grant_refused");
            expect(printed()).toContain("cli");
        });

        it("can still be revoked from the terminal", async () => {
            // Removing an administrator during an incident must not need a DBA. The bootstrap is what grants it, so
            // this is set up the way the bootstrap does.
            const member = await context.members.ensureMember("boss@example.com");
            const tag = await context.members.ensureTag("admin");
            await context.members.grantTag(member.id, tag.id);
            output = [];

            const result = await revokeTag(context, "boss@example.com", "admin");

            expect(result.exitCode).toBe(0);
            expect(printed()).toContain('Revoked "admin"');
            expect((await context.members.findByEmail("boss@example.com"))?.tags).toEqual([]);
        });
    });

    describe("audit", () => {
        it("records what the CLI did, attributed to the CLI", async () => {
            // The audit write lives in the shared service, so the terminal cannot forget it any more than the
            // dashboard can. The actor is `cli` rather than a person: a command in the container has no identity,
            // and inventing one would put a name in the log that nobody can stand behind.
            await grantTag(context, "alice@example.com", "editor");
            await revokeTag(context, "alice@example.com", "editor");
            await setMemberName(context, "alice@example.com", "Alice");
            output = [];

            await listAudit(context, undefined);

            expect(printed()).toContain("cli");
            expect(printed()).toContain("tag.granted");
            expect(printed()).toContain("tag.revoked");
            expect(printed()).toContain("member.renamed");
            expect(printed()).toContain("3 entries.");
        });

        it("narrows to one member", async () => {
            await grantTag(context, "alice@example.com", "editor");
            await grantTag(context, "bob@example.com", "editor");
            output = [];

            await listAudit(context, "alice@example.com");

            expect(printed()).toContain("alice@example.com");
            expect(printed()).not.toContain("bob@example.com");
            expect(printed()).toContain("1 entry.");
        });

        it("says so when nothing has happened", async () => {
            await listAudit(context, undefined);

            expect(printed()).toBe("Nothing recorded yet.");
        });
    });
});

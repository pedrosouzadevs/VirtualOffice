import { describe, expect, it } from "vitest";
import { bootstrapAdmin } from "../src/Application/BootstrapAdminService";
import type { MemberRepository } from "../src/Application/Ports/MemberRepository";
import { normalizeEmail, type Member, type MemberSummary } from "../src/Domain/Member";

/**
 * In-memory stand-in for the repository.
 *
 * Covers the orchestration — which tags, which grants, what happens with no email — without a database. The SQL-level
 * guarantees these rely on (`ON CONFLICT DO NOTHING`, cascades, unique constraints) are covered against a real
 * Postgres in `tests/integration`, because a fake cannot prove them.
 */
class InMemoryMemberRepository implements MemberRepository {
    readonly members = new Map<string, Member & { tags: string[] }>();
    readonly tags = new Map<string, string>();
    ensureTagCalls: string[] = [];

    findByEmail(email: string): Promise<Member | undefined> {
        return Promise.resolve(this.members.get(normalizeEmail(email)));
    }

    search(): Promise<MemberSummary[]> {
        return Promise.reject(new Error("Not needed by these tests."));
    }

    ensureMember(email: string, username?: string): Promise<Member> {
        const normalized = normalizeEmail(email);
        const existing = this.members.get(normalized);
        if (existing) {
            return Promise.resolve(existing);
        }

        const created = {
            id: `id-${normalized}`,
            email: normalized,
            oidcSub: null,
            username: username ?? null,
            tags: [] as string[],
        };
        this.members.set(normalized, created);

        return Promise.resolve(created);
    }

    ensureTag(name: string): Promise<{ id: string; name: string }> {
        this.ensureTagCalls.push(name);
        const id = this.tags.get(name) ?? `tag-${name}`;
        this.tags.set(name, id);

        return Promise.resolve({ id, name });
    }

    grantTag(memberId: string, tagId: string): Promise<void> {
        for (const member of this.members.values()) {
            if (member.id === memberId && !member.tags.includes(tagId.replace(/^tag-/, ""))) {
                member.tags.push(tagId.replace(/^tag-/, ""));
            }
        }

        return Promise.resolve();
    }
}

describe("bootstrapAdmin", () => {
    it("ensures exactly the tags that grant map-editor access", async () => {
        const repository = new InMemoryMemberRepository();

        const result = await bootstrapAdmin(repository, undefined);

        expect(repository.ensureTagCalls).toEqual(["admin", "editor"]);
        expect(result.ensuredTags).toEqual(["admin", "editor"]);
    });

    it("grants the admin tag to the configured email", async () => {
        const repository = new InMemoryMemberRepository();

        const result = await bootstrapAdmin(repository, "boss@example.com");

        expect(result.adminEmail).toBe("boss@example.com");
        expect((await repository.findByEmail("boss@example.com"))?.tags).toEqual(["admin"]);
    });

    it("creates the tags but no administrator when the email is unset", async () => {
        const repository = new InMemoryMemberRepository();

        const result = await bootstrapAdmin(repository, undefined);

        expect(result.adminEmail).toBeUndefined();
        expect(repository.members.size).toBe(0);
    });

    it("treats an empty string as unset, because Compose interpolates missing vars to ''", async () => {
        const repository = new InMemoryMemberRepository();

        const result = await bootstrapAdmin(repository, "   ");

        expect(result.adminEmail).toBeUndefined();
        expect(repository.members.size).toBe(0);
    });
});

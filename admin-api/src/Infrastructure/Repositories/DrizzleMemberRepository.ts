import { and, asc, eq, ilike, or, type SQL } from "drizzle-orm";
import type { MemberRepository } from "../../Application/Ports/MemberRepository";
import { normalizeEmail, type Member, type MemberSummary } from "../../Domain/Member";
import type { Database } from "../Database/connection";
import { member, memberTag, tag } from "../Database/schema";

/**
 * Wraps `text` in a LIKE pattern with its wildcards neutralised.
 *
 * `%` and `_` are wildcards and `\` escapes them. Escaping the backslash **first** matters: doing it last would
 * re-escape the backslashes the other two replacements just introduced.
 */
function likePattern(text: string): string {
    return `%${text.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
}

export class DrizzleMemberRepository implements MemberRepository {
    constructor(private readonly db: Database) {}

    async findByEmail(email: string): Promise<Member | undefined> {
        const rows = await this.db
            .select({
                id: member.id,
                email: member.email,
                oidcSub: member.oidcSub,
                username: member.username,
                tagName: tag.name,
            })
            .from(member)
            .leftJoin(memberTag, eq(memberTag.memberId, member.id))
            .leftJoin(tag, eq(tag.id, memberTag.tagId))
            .where(eq(member.email, normalizeEmail(email)));

        const first = rows[0];
        if (first === undefined) {
            return undefined;
        }

        // The join produces one row per tag, and a member with no tags still yields a single row with a null tagName.
        return {
            id: first.id,
            email: first.email,
            oidcSub: first.oidcSub,
            username: first.username,
            tags: rows.map((row) => row.tagName).filter((name): name is string => name !== null),
        };
    }

    async search(searchText: string, limit: number): Promise<MemberSummary[]> {
        const trimmed = searchText.trim();
        if (trimmed === "") {
            return [];
        }

        const pattern = likePattern(trimmed);

        return this.db
            .select({ id: member.id, email: member.email, username: member.username })
            .from(member)
            .where(or(ilike(member.email, pattern), ilike(member.username, pattern)))
            .orderBy(asc(member.email))
            .limit(limit);
    }

    async searchWithTags(searchText: string, limit: number): Promise<Member[]> {
        const trimmed = searchText.trim();
        if (trimmed === "") {
            return [];
        }

        const pattern = likePattern(trimmed);

        return this.selectWithTags(or(ilike(member.email, pattern), ilike(member.username, pattern)), limit);
    }

    async ensureMember(email: string, username?: string): Promise<Member> {
        const normalizedEmail = normalizeEmail(email);

        // ON CONFLICT DO NOTHING rather than an upsert: re-running the bootstrap must never overwrite a username or
        // an oidc_sub that has been filled in since.
        await this.db.insert(member).values({ email: normalizedEmail, username }).onConflictDoNothing();

        const existing = await this.findByEmail(normalizedEmail);
        if (existing === undefined) {
            throw new Error(`Member "${normalizedEmail}" could not be read back right after being ensured.`);
        }

        return existing;
    }

    async ensureTag(name: string): Promise<{ id: string; name: string }> {
        await this.db.insert(tag).values({ name }).onConflictDoNothing();

        const rows = await this.db.select({ id: tag.id, name: tag.name }).from(tag).where(eq(tag.name, name));

        const existing = rows[0];
        if (existing === undefined) {
            throw new Error(`Tag "${name}" could not be read back right after being ensured.`);
        }

        return existing;
    }

    async grantTag(memberId: string, tagId: string): Promise<void> {
        await this.db.insert(memberTag).values({ memberId, tagId }).onConflictDoNothing();
    }

    async revokeTag(memberId: string, tagId: string): Promise<void> {
        // Deleting a row that is not there affects zero rows, which is exactly the idempotence we want.
        await this.db.delete(memberTag).where(and(eq(memberTag.memberId, memberId), eq(memberTag.tagId, tagId)));
    }

    async setUsername(email: string, username: string | null): Promise<Member | undefined> {
        const normalizedEmail = normalizeEmail(email);

        const updated = await this.db
            .update(member)
            .set({ username, updatedAt: new Date() })
            .where(eq(member.email, normalizedEmail))
            .returning({ id: member.id });

        if (updated.length === 0) {
            return undefined;
        }

        return this.findByEmail(normalizedEmail);
    }

    listAll(limit: number): Promise<Member[]> {
        return this.selectWithTags(undefined, limit);
    }

    /**
     * The one query that reads members with their tags, optionally filtered.
     *
     * Shared by {@link listAll} and {@link searchWithTags} so the folding below — which is the subtle part — exists
     * once. `undefined` means no filter.
     */
    private async selectWithTags(where: SQL | undefined, limit: number): Promise<Member[]> {
        const rows = await this.db
            .select({
                id: member.id,
                email: member.email,
                oidcSub: member.oidcSub,
                username: member.username,
                tagName: tag.name,
            })
            .from(member)
            .leftJoin(memberTag, eq(memberTag.memberId, member.id))
            .leftJoin(tag, eq(tag.id, memberTag.tagId))
            .where(where)
            .orderBy(asc(member.email), asc(tag.name));

        // The join yields one row per tag, so fold them back into one entry per member. The limit is applied after
        // folding: applying it to the join would truncate a member's tags rather than the member list.
        const byEmail = new Map<string, { member: Omit<Member, "tags">; tags: string[] }>();

        for (const row of rows) {
            const existing = byEmail.get(row.email);
            const target = existing ?? {
                member: { id: row.id, email: row.email, oidcSub: row.oidcSub, username: row.username },
                tags: [],
            };

            if (row.tagName !== null) {
                target.tags.push(row.tagName);
            }

            byEmail.set(row.email, target);
        }

        return [...byEmail.values()]
            .slice(0, limit)
            .map(({ member: found, tags: names }) => ({ ...found, tags: names }));
    }
}

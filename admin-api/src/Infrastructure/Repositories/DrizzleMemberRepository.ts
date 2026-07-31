import { eq } from "drizzle-orm";
import type { MemberRepository } from "../../Application/Ports/MemberRepository";
import { normalizeEmail, type Member } from "../../Domain/Member";
import type { Database } from "../Database/connection";
import { member, memberTag, tag } from "../Database/schema";

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
}

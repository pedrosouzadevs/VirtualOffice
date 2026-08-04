import type { BanRecord, NewBan } from "../../Domain/Ban";

/**
 * Append-only storage for who was thrown out, and by whom.
 *
 * No update and no delete, like {@link AuditLogRepository}: a ban is evidence of a decision somebody made, and a
 * record that can be quietly rewritten is not evidence. Lifting a ban is not part of P3 (ADR-0005) and is done with
 * direct SQL, which is documented in `docs/SETUP-ADMIN-API.md` — the same route member deletion takes.
 */
export interface BanRepository {
    /** Writes one ban. Never throws for business reasons; a failure here means the database is in trouble. */
    record(ban: NewBan): Promise<BanRecord>;

    /**
     * The ban in force for an identifier, or `undefined` when there is none.
     *
     * Answers with the **most recent** one when somebody was banned more than once, because that is the message they
     * should be shown. An unknown identifier is not an error: `GET /api/ban` answers `is_banned: false` for everyone
     * it has never heard of, which is every user on every connection.
     */
    findActive(identifier: string): Promise<BanRecord | undefined>;

    /**
     * The most recent bans, newest first.
     *
     * Bounded because the table only grows. A screen that wants more than this wants pagination, which is a different
     * feature than "show me what just happened".
     */
    listRecent(limit: number): Promise<BanRecord[]>;
}

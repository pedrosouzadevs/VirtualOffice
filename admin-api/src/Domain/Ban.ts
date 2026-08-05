/**
 * Somebody an administrator threw out of the world.
 *
 * The subject is a **person, not a room** (ADR-0005, decision #1): one world exists, so a per-room ban would be a
 * distinction with no consequence and no screen to express it. `roomUrl` is kept as evidence of where it happened.
 */
export interface BanRecord {
    readonly id: string;

    /**
     * Who was banned, as the pusher named them.
     *
     * An **identifier**, not a member reference, and that is deliberate. The pusher sends whatever it holds in
     * `socketData.userUuid`: an email for a member who logged in, an anonymous uuid for a visitor who did not. A
     * foreign key would force an anonymous visitor to become a member row — an account nobody can ever log into —
     * and would let deleting that row lift the ban, which is precisely backwards.
     *
     * The same reasoning the audit log is built on: see the note on `audit_log` in `schema.ts`.
     */
    readonly identifier: string;

    /** The name they were carrying at the time, as the pusher sent it. A snapshot, for reading the record later. */
    readonly displayName: string | null;

    /** What the banned person is told. Answered verbatim by `GET /api/ban`. */
    readonly message: string;

    /** Where it happened. Evidence, never scope — the ban applies everywhere regardless of this value. */
    readonly roomUrl: string;

    /** The administrator who issued it, as the pusher named them. A snapshot, like every identity in a record. */
    readonly issuedBy: string;

    readonly createdAt: Date;
}

/** A ban as it is issued, before storage gives it an id and a timestamp. */
export interface NewBan {
    readonly identifier: string;
    readonly displayName: string | null;
    readonly message: string;
    readonly roomUrl: string;
    readonly issuedBy: string;
}

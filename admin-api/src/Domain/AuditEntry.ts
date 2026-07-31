/**
 * What a dashboard administrator did.
 *
 * A closed set rather than free text: an audit log is only useful if it can be queried, and "every distinct value
 * anyone ever typed" is not a queryable column. Adding an action means adding it here, which is the point at which
 * somebody has to decide what it is called.
 */
export const AUDIT_ACTIONS = ["tag.granted", "tag.revoked", "member.renamed"] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * One entry, as the application writes it.
 *
 * Both identities are emails **as they were at the time**, not references. See the note on `audit_log` in
 * `schema.ts`: an entry that follows a renamed or deleted member is an entry that has stopped being evidence.
 */
export interface AuditEntry {
    readonly actorEmail: string;
    readonly action: AuditAction;
    readonly targetEmail: string;
    /** Enough context to read the entry without looking anything else up. */
    readonly details: Record<string, unknown>;
}

/** A written entry, as it comes back out. */
export interface RecordedAuditEntry extends AuditEntry {
    readonly id: string;
    readonly createdAt: Date;
}

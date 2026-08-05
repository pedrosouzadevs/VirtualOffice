import type { AuditEntry, RecordedAuditEntry } from "../../Domain/AuditEntry";

/**
 * Append-only storage for what the dashboard did.
 *
 * There is no update and no delete, and that is the interface's main statement: the only way to change this log is to
 * add to it. ADR-0004 decision #5 brought it forward from P4 for one reason — a tag granted today and questioned in
 * six months has no answer unless the answer was written today.
 */
export interface AuditLogRepository {
    /** Writes one entry. Never throws for business reasons; a failure here means the database is in trouble. */
    record(entry: AuditEntry): Promise<void>;

    /**
     * The most recent entries, newest first.
     *
     * Bounded because the log only grows. A screen that wants more than this wants pagination, which is a different
     * feature than "show me what just happened".
     */
    listRecent(limit: number): Promise<RecordedAuditEntry[]>;

    /** Everything that ever happened to one member, newest first. */
    listForTarget(targetEmail: string, limit: number): Promise<RecordedAuditEntry[]>;
}

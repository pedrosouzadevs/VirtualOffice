import { desc, eq } from "drizzle-orm";
import type { AuditLogRepository } from "../../Application/Ports/AuditLogRepository";
import { normalizeEmail } from "../../Domain/Member";
import type { AuditAction, AuditEntry, RecordedAuditEntry } from "../../Domain/AuditEntry";
import type { Database } from "../Database/connection";
import { auditLog } from "../Database/schema";

/** The shape a row comes back as, before it is narrowed to the domain type. */
interface AuditRow {
    id: string;
    actorEmail: string;
    action: string;
    targetEmail: string;
    details: unknown;
    createdAt: Date;
}

function toEntry(row: AuditRow): RecordedAuditEntry {
    return {
        id: row.id,
        actorEmail: row.actorEmail,
        // Cast rather than validated: the column is only ever written from `AuditAction`, and an old row whose action
        // has since been renamed is still a fact worth reading. Refusing to read history is not a safety property.
        action: row.action as AuditAction,
        targetEmail: row.targetEmail,
        details: (row.details ?? {}) as Record<string, unknown>,
        createdAt: row.createdAt,
    };
}

export class DrizzleAuditLogRepository implements AuditLogRepository {
    constructor(private readonly db: Database) {}

    async record(entry: AuditEntry): Promise<void> {
        await this.db.insert(auditLog).values({
            // Normalised on the way in, like every other email here, so a query for one person finds every entry.
            actorEmail: normalizeEmail(entry.actorEmail),
            action: entry.action,
            targetEmail: normalizeEmail(entry.targetEmail),
            details: entry.details,
        });
    }

    async listRecent(limit: number): Promise<RecordedAuditEntry[]> {
        const rows = await this.db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(limit);

        return rows.map(toEntry);
    }

    async listForTarget(targetEmail: string, limit: number): Promise<RecordedAuditEntry[]> {
        const rows = await this.db
            .select()
            .from(auditLog)
            .where(eq(auditLog.targetEmail, normalizeEmail(targetEmail)))
            .orderBy(desc(auditLog.createdAt))
            .limit(limit);

        return rows.map(toEntry);
    }
}

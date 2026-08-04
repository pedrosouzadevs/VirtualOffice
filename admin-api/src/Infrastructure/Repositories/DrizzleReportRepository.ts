import { desc } from "drizzle-orm";
import type { ReportRepository } from "../../Application/Ports/ReportRepository";
import { normalizeIdentifier } from "../../Domain/Member";
import type { NewReport, ReportRecord } from "../../Domain/Report";
import type { Database } from "../Database/connection";
import { report } from "../Database/schema";

/** The shape a row comes back as, before it is narrowed to the domain type. */
interface ReportRow {
    id: string;
    reportedIdentifier: string;
    reporterIdentifier: string;
    comment: string;
    roomUrl: string;
    createdAt: Date;
}

function toRecord(row: ReportRow): ReportRecord {
    return {
        id: row.id,
        reportedIdentifier: row.reportedIdentifier,
        reporterIdentifier: row.reporterIdentifier,
        comment: row.comment,
        roomUrl: row.roomUrl,
        createdAt: row.createdAt,
    };
}

export class DrizzleReportRepository implements ReportRepository {
    constructor(private readonly db: Database) {}

    async record(entry: NewReport): Promise<ReportRecord> {
        const [row] = await this.db
            .insert(report)
            .values({
                // Normalised on the way in, like every other identifier here, so every report about one person is
                // found by one query.
                reportedIdentifier: normalizeIdentifier(entry.reportedIdentifier),
                reporterIdentifier: normalizeIdentifier(entry.reporterIdentifier),
                comment: entry.comment,
                roomUrl: entry.roomUrl,
            })
            .returning();

        if (row === undefined) {
            // Postgres cannot insert nothing and return no row; this is unreachable and is here so the caller gets a
            // real object rather than a type assertion pretending it does.
            throw new Error("The report was not written.");
        }

        return toRecord(row);
    }

    async listRecent(limit: number): Promise<ReportRecord[]> {
        const rows = await this.db.select().from(report).orderBy(desc(report.createdAt)).limit(limit);

        return rows.map(toRecord);
    }
}

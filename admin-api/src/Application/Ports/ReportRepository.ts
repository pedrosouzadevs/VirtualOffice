import type { NewReport, ReportRecord } from "../../Domain/Report";

/**
 * Append-only storage for what users complained about.
 *
 * No update and no delete, like the audit log and the ban table. A report is somebody's account of something that
 * happened; a record that can be quietly rewritten is not an account of anything.
 *
 * There is no "resolve" or "dismiss" here, and that is P3's scope being honest rather than an oversight: nobody owns
 * triage yet (ADR-0005, decision #4). Adding a state machine before there is a person to run it would be inventing a
 * workflow, and the column would sit at its default forever.
 */
export interface ReportRepository {
    /** Writes one report. Never throws for business reasons; a failure here means the database is in trouble. */
    record(report: NewReport): Promise<ReportRecord>;

    /**
     * The most recent reports, newest first.
     *
     * Bounded because the table only grows. A screen that wants more than this wants pagination, which is a different
     * feature than "show me what just came in".
     */
    listRecent(limit: number): Promise<ReportRecord[]>;
}

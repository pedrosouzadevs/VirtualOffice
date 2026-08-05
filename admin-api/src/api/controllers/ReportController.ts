import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { ReportRepository } from "../../Application/Ports/ReportRepository";

/**
 * What `POST /api/report` receives.
 *
 * A **JSON body**, not the query string the pusher's own OpenAPI comment declares with `in: "query"`, and the room
 * arrives renamed to `reportWorldSlug` (ADR-0005, correction #3). Reading the documented shape produces an endpoint
 * that stores four empty strings for every report, silently.
 *
 * **Only `reportedUserUuid` is required.** The pusher swallows a failure here into Sentry and the report is lost, so
 * refusing an incomplete one destroys the very thing it was trying to protect. A report with no comment is thin
 * evidence; no report at all is none.
 */
const ReportRequest = z.object({
    reportedUserUuid: z.string().min(1),
    reportedUserComment: z.string().optional(),
    reporterUserUuid: z.string().optional(),
    reportWorldSlug: z.string().optional(),
});

/**
 * `POST /api/report`.
 *
 * Called by `SocketManager.handleReportMessage`, unconditionally, since no capability gates it (correction #8) — so
 * every report made since `ADMIN_API_URL` was set has hit our 404 and been dropped.
 *
 * Storing is all this does. No email, no webhook, no queue: a notification channel nobody has agreed to watch is the
 * failure mode the audit log already taught us (ADR-0005, decision #4). When somebody owns triage, `AdminAlerter` is
 * the seam that is already there.
 */
export class ReportController {
    constructor(
        private readonly app: Express,
        private readonly reports: ReportRepository,
    ) {
        this.report();
    }

    private report(): void {
        this.app.post("/api/report", (req: Request, res: Response, next: NextFunction) => {
            (async () => {
                const body = ReportRequest.safeParse(req.body);

                if (!body.success) {
                    res.status(400).json({
                        status: "error",
                        type: "error",
                        code: "INVALID_REPORT_REQUEST",
                        title: "Invalid request",
                        subtitle: "",
                        details: "reportedUserUuid is required and must be a string.",
                    });
                    return;
                }

                const { reportedUserUuid, reportedUserComment, reporterUserUuid, reportWorldSlug } = body.data;

                await this.reports.record({
                    reportedIdentifier: reportedUserUuid,
                    reporterIdentifier: reporterUserUuid ?? "",
                    comment: reportedUserComment ?? "",
                    roomUrl: reportWorldSlug ?? "",
                });

                // The pusher types this call as `Promise<unknown>` and ignores what comes back; it only needs the call
                // not to throw. JSON keeps every caller of this API parsing JSON.
                res.status(200).json({ success: true });
            })().catch((error: unknown) => {
                console.error(`[${new Date().toISOString()}] Failed to record a report`, error);
                next(error);
            });
        });
    }
}

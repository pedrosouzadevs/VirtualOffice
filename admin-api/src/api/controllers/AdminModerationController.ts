import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { BanRepository } from "../../Application/Ports/BanRepository";
import type { ReportRepository } from "../../Application/Ports/ReportRepository";

/** Enough to answer "what has been happening" without turning either endpoint into a data export. */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

const ListQuery = z.object({
    limit: z.coerce.number().int().positive().max(MAX_LIMIT).optional(),
});

/**
 * `GET /admin/api/bans` and `GET /admin/api/reports` — moderation, read-only (ADR-0005, H3).
 *
 * **Read-only in both directions, and deliberately so.** Bans are issued from `play`, where the administrator can see
 * who they are throwing out; reports are written by the users who make them. A dashboard that could issue a ban would
 * be a second way to do it with a different audit story, and nothing here can lift one — P3 does not decide what
 * lifting a ban means, and inventing a button for it would be deciding by accident. Removing a row is direct SQL, the
 * same route member deletion takes, and it is written down in `docs/SETUP-ADMIN-API.md`.
 */
export class AdminModerationController {
    constructor(
        private readonly app: Express,
        private readonly bans: BanRepository,
        private readonly reports: ReportRepository,
    ) {
        this.listBans();
        this.listReports();
    }

    /** @returns the limit, or `undefined` after answering 400 itself. */
    private limitOr400(req: Request, res: Response): number | undefined {
        const query = ListQuery.safeParse(req.query);

        if (!query.success) {
            res.status(400).json({
                status: "error",
                type: "error",
                code: "ADMIN_INVALID_MODERATION_QUERY",
                title: "Invalid request",
                subtitle: "",
                details: `limit must be a positive integer up to ${MAX_LIMIT}.`,
            });
            return undefined;
        }

        return query.data.limit ?? DEFAULT_LIMIT;
    }

    private listBans(): void {
        this.app.get("/admin/api/bans", (req: Request, res: Response, next: NextFunction) => {
            (async () => {
                const limit = this.limitOr400(req, res);

                if (limit !== undefined) {
                    res.status(200).json(await this.bans.listRecent(limit));
                }
            })().catch((error: unknown) => {
                console.error(`[${new Date().toISOString()}] Failed to list bans`, error);
                next(error);
            });
        });
    }

    private listReports(): void {
        this.app.get("/admin/api/reports", (req: Request, res: Response, next: NextFunction) => {
            (async () => {
                const limit = this.limitOr400(req, res);

                if (limit !== undefined) {
                    res.status(200).json(await this.reports.listRecent(limit));
                }
            })().catch((error: unknown) => {
                console.error(`[${new Date().toISOString()}] Failed to list reports`, error);
                next(error);
            });
        });
    }
}

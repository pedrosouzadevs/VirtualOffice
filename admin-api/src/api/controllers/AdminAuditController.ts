import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { AuditLogRepository } from "../../Application/Ports/AuditLogRepository";

/** Enough to answer "what just happened" without turning the endpoint into a data export. */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

const AuditQuery = z.object({
    /** Narrows to everything that ever happened to one member. */
    target: z.string().max(320).optional(),
    limit: z.coerce.number().int().positive().max(MAX_LIMIT).optional(),
});

/**
 * `GET /admin/api/audit` — reading the append-only log (ADR-0004, decision #5).
 *
 * Read-only, and there is no counterpart that writes through here: entries are written by the handlers that make the
 * change, never by a caller. A log anyone can post to is not evidence of anything.
 */
export class AdminAuditController {
    constructor(
        private readonly app: Express,
        private readonly audit: AuditLogRepository,
    ) {
        this.listEntries();
    }

    private listEntries(): void {
        this.app.get("/admin/api/audit", (req: Request, res: Response, next: NextFunction) => {
            (async () => {
                const query = AuditQuery.safeParse(req.query);

                if (!query.success) {
                    res.status(400).json({
                        status: "error",
                        type: "error",
                        code: "ADMIN_INVALID_AUDIT_QUERY",
                        title: "Invalid request",
                        subtitle: "",
                        details: `target must be a string and limit a positive integer up to ${MAX_LIMIT}.`,
                    });
                    return;
                }

                const limit = query.data.limit ?? DEFAULT_LIMIT;
                const entries =
                    query.data.target === undefined
                        ? await this.audit.listRecent(limit)
                        : await this.audit.listForTarget(query.data.target, limit);

                res.status(200).json(entries);
            })().catch((error: unknown) => {
                console.error(`[${new Date().toISOString()}] Failed to read the audit log`, error);
                next(error);
            });
        });
    }
}

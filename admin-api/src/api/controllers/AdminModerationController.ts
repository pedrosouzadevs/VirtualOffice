import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { banIdentifier } from "../../Application/BanService";
import type { Actor } from "../../Application/AuditRecording";
import type { AuditLogRepository } from "../../Application/Ports/AuditLogRepository";
import type { BanRepository } from "../../Application/Ports/BanRepository";
import type { MemberRepository } from "../../Application/Ports/MemberRepository";
import type { ReportRepository } from "../../Application/Ports/ReportRepository";
import type { WorldKicker } from "../../Application/Ports/WorldKicker";

/** Enough to answer "what has been happening" without turning either endpoint into a data export. */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

const ListQuery = z.object({
    limit: z.coerce.number().int().positive().max(MAX_LIMIT).optional(),
});

const IssueBanRequest = z.object({
    identifier: z.string().trim().min(1),
    message: z.string().optional(),
});

/** What the removed person is shown when the administrator wrote nothing — the in-world path's own wording. */
const DEFAULT_BAN_MESSAGE = "You have been banned by an admin";

export interface AdminModerationDependencies {
    readonly bans: BanRepository;
    readonly reports: ReportRepository;
    /** Banning is a mutation, so it is recorded naming the actor, like every other one (ADR-0004, decision #5). */
    readonly audit: AuditLogRepository;
    /** Puts a display name on the record when the identifier is a member we know. */
    readonly members: MemberRepository;
    /** Absent when the kick channel is not configured: the ban still lands, `kicked` answers `false`. */
    readonly kicker?: WorldKicker;
}

/**
 * `/admin/api/bans` and `/admin/api/reports` — moderation (ADR-0005 H3, revised by ADR-0006).
 *
 * The dashboard **issues** bans (ADR-0006, decision #1) and reads both lists. It still cannot lift a ban — that
 * stays direct SQL, because P3's reasoning stands: what lifting *means* is undecided, and a button would decide it
 * by accident. Reports remain read-only entirely: they are written by the users who make them.
 */
export class AdminModerationController {
    constructor(
        private readonly app: Express,
        private readonly dependencies: AdminModerationDependencies,
    ) {
        this.issueBan();
        this.listBans();
        this.listReports();
    }

    /** The administrator this request acts as — read by the barrier from the database, never from the caller. */
    private actor(req: Request): Actor {
        const acting = req.adminMember;

        if (acting === undefined) {
            // Unreachable behind the barrier. Throwing rather than falling back to an anonymous actor: an audit
            // trail that cannot name who acted is worse than a failed request.
            throw new Error("A dashboard mutation reached its handler with no acting administrator.");
        }

        return { kind: "administrator", email: acting.email };
    }

    private issueBan(): void {
        this.app.post("/admin/api/bans", (req: Request, res: Response, next: NextFunction) => {
            (async () => {
                const body = IssueBanRequest.safeParse(req.body);

                if (!body.success) {
                    res.status(400).json({
                        status: "error",
                        type: "error",
                        code: "ADMIN_INVALID_BAN_REQUEST",
                        title: "Invalid request",
                        subtitle: "",
                        details: "identifier is required and must be a non-empty string.",
                    });
                    return;
                }

                const actor = this.actor(req);
                const { identifier } = body.data;
                const message = body.data.message?.trim() === "" ? undefined : body.data.message?.trim();

                // A display name makes the record readable months later; the member row is the one place it exists.
                const member = await this.dependencies.members.findByEmail(identifier);

                const ban = await banIdentifier(
                    { bans: this.dependencies.bans, audit: this.dependencies.audit },
                    actor,
                    {
                        identifier,
                        displayName: member?.username ?? null,
                        message: message ?? DEFAULT_BAN_MESSAGE,
                        // A dashboard ban happens outside any room; the ban is global to the person either way
                        // (ADR-0005, decision #1).
                        roomUrl: "",
                        issuedBy: actor.kind === "administrator" ? actor.email : "cli",
                    },
                );

                // After the record, never before, and best-effort (ADR-0006, decision #3): the ban is the record
                // plus the closed door, and a pusher hiccup must not un-record it.
                const kicked =
                    this.dependencies.kicker === undefined
                        ? false
                        : await this.dependencies.kicker.kick(ban.identifier, ban.message);

                res.status(201).json({ ban, kicked });
            })().catch((error: unknown) => {
                console.error(`[${new Date().toISOString()}] Failed to issue a ban`, error);
                next(error);
            });
        });
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
                    res.status(200).json(await this.dependencies.bans.listRecent(limit));
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
                    res.status(200).json(await this.dependencies.reports.listRecent(limit));
                }
            })().catch((error: unknown) => {
                console.error(`[${new Date().toISOString()}] Failed to list reports`, error);
                next(error);
            });
        });
    }
}

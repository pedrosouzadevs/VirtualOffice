import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { banIdentifier, checkBan, type BanAdministration } from "../../Application/BanService";

/**
 * What `GET /api/ban` receives.
 *
 * The parameter carrying the user is named **`token`**, not `userUuid` — the pusher's own OpenAPI comment describes it
 * as "the uuid of the user" while the code sends `token` (ADR-0005, correction #2). Reading the documented name
 * instead of this one produces an endpoint that answers "not banned" for everybody, silently.
 */
const BanCheckQuery = z.object({
    token: z.string().min(1),

    /**
     * Accepted and dropped (ADR-0005, decision #3).
     *
     * An IP address is personal data under the LGPD, it identifies a household rather than a person, and it is the one
     * field here that would arrive with a retention obligation attached. Declared so the shape of the request is
     * documented where it is parsed, and used for nothing.
     */
    ipAddress: z.string().optional(),

    /** Where the check was made. Evidence at most: a ban is global to the person (ADR-0005, decision #1). */
    roomUrl: z.string().optional(),
});

/**
 * What `POST /api/ban` receives, field for field as `AdminApi.banUserByUuid` sends it.
 *
 * **Only `uuidToBan` is required**, and that is a deliberate trade rather than sloppiness. The pusher awaits this call
 * *before* `emitBan`, so anything we refuse means the administrator watches nothing happen and the user stays in the
 * room — the exact failure P3 exists to repair. There is nothing here worth failing a kick over.
 */
const BanRequest = z.object({
    uuidToBan: z.string().min(1),
    playUri: z.string().optional(),
    name: z.string().optional(),
    message: z.string().optional(),
    byUserUuid: z.string().optional(),
});

/** What the audit log records when the pusher did not say who asked. Never a real identity, so the two cannot mix. */
const UNKNOWN_ACTOR = "unknown";

/**
 * `GET /api/ban` and `POST /api/ban` — **two endpoints on one path** (ADR-0005, correction #1).
 *
 * `POST` issues a ban and is called by `SocketManager.handleBanPlayerMessage`. `GET` checks one and, today, is called
 * by nothing at all: `verifyBanUser` exists in the pusher's interface and both implementations with no caller anywhere
 * (correction #7). It is implemented anyway — it reads a table P3 builds regardless, and a 404 on a path the pusher's
 * own interface declares is a trap for whoever wires that caller up later.
 *
 * Neither is gated by a capability, so both have been called since `ADMIN_API_URL` was set (correction #8).
 */
export class BanController {
    constructor(
        private readonly app: Express,
        private readonly administration: BanAdministration,
    ) {
        this.checkBan();
        this.banUser();
    }

    private checkBan(): void {
        this.app.get("/api/ban", (req: Request, res: Response, next: NextFunction) => {
            (async () => {
                const query = BanCheckQuery.safeParse(req.query);

                if (!query.success) {
                    res.status(400).json({
                        status: "error",
                        type: "error",
                        code: "INVALID_BAN_CHECK_QUERY",
                        title: "Invalid request",
                        subtitle: "",
                        details: "token is required and must be a string.",
                    });
                    return;
                }

                // `ipAddress` is parsed above and deliberately never read: nothing downstream receives it.
                res.status(200).json(await checkBan(this.administration.bans, query.data.token));
            })().catch((error: unknown) => {
                console.error(`[${new Date().toISOString()}] Failed to check a ban`, error);
                next(error);
            });
        });
    }

    private banUser(): void {
        this.app.post("/api/ban", (req: Request, res: Response, next: NextFunction) => {
            (async () => {
                const body = BanRequest.safeParse(req.body);

                if (!body.success) {
                    res.status(400).json({
                        status: "error",
                        type: "error",
                        code: "INVALID_BAN_REQUEST",
                        title: "Invalid request",
                        subtitle: "",
                        details: "uuidToBan is required and must be a string.",
                    });
                    return;
                }

                const { uuidToBan, playUri, name, message, byUserUuid } = body.data;
                const issuedBy = byUserUuid?.trim() === "" ? undefined : byUserUuid;

                await banIdentifier(
                    this.administration,
                    // The pusher only reaches here for a user holding the `admin` tag — `handleBanPlayerMessage`
                    // returns early otherwise — so the actor is a real administrator, named by the identifier the
                    // pusher knows them by.
                    { kind: "administrator", email: issuedBy ?? UNKNOWN_ACTOR },
                    {
                        identifier: uuidToBan,
                        displayName: name?.trim() === "" ? null : (name ?? null),
                        message: message ?? "",
                        roomUrl: playUri ?? "",
                        issuedBy: issuedBy ?? UNKNOWN_ACTOR,
                    },
                );

                // The pusher types this call as `Promise<boolean>` and then ignores what comes back — it only needs
                // the call not to throw, because `emitBan` runs next. A small JSON object keeps every caller of this
                // API parsing JSON, which the shared 404 and error handlers also rely on.
                res.status(200).json({ success: true });
            })().catch((error: unknown) => {
                console.error(`[${new Date().toISOString()}] Failed to ban a user`, error);
                next(error);
            });
        });
    }
}

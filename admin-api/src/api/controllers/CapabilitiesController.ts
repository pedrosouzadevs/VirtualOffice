import type { Capabilities } from "@workadventure/messages";
import type { Express, Request, Response } from "express";

/**
 * `GET /api/capabilities` — the capability negotiation the pusher performs at startup.
 *
 * ⚠️ This endpoint **must** answer 200. `AdminApi.initialise()` retries on any exception with no cap, and
 * `server.ts` awaits `app.init()` before it starts listening, so a 404, a 403 or a 500 here leaves the pusher
 * hanging forever without ever opening its HTTP/WS port (ADR-0002, Trap #2).
 *
 * It is also the one endpoint the pusher calls with no `Authorization` header, so it is mounted outside the token
 * guard — see `adminApiTokenAuthentication`.
 */
export class CapabilitiesController {
    constructor(
        private readonly app: Express,
        private readonly capabilities: Capabilities,
    ) {
        this.getCapabilities();
    }

    private getCapabilities(): void {
        this.app.get("/api/capabilities", (req: Request, res: Response) => {
            res.status(200).json(this.capabilities);
        });
    }
}

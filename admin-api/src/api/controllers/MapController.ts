import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { buildMapDetails, type MapDetailsConfiguration } from "../../Application/MapDetailsService";

const MapQuery = z.object({
    playUri: z.string().min(1),
    // Sent by the pusher when the user is identified. Unused in P0 — access is not yet per-member — but declared so
    // the contract is visible and so a future change does not have to rediscover it.
    userId: z.string().optional(),
    accessToken: z.string().optional(),
});

/**
 * `GET /api/map` — resolves a room URL into map details, a redirect, or a typed error.
 *
 * The pusher parses our answer against `isMapDetailsData`, then `isRoomRedirect`, then `isErrorApiErrorData`, and
 * shows a generic "Invalid server response" screen if all three fail. Every branch here must therefore satisfy one of
 * those schemas — which is exactly what the contract tests assert.
 */
export class MapController {
    constructor(
        private readonly app: Express,
        private readonly configuration: MapDetailsConfiguration,
    ) {
        this.getMap();
    }

    private getMap(): void {
        this.app.get("/api/map", (req: Request, res: Response, next: NextFunction) => {
            try {
                const query = MapQuery.safeParse(req.query);

                if (!query.success) {
                    res.status(400).json({
                        status: "error",
                        type: "error",
                        code: "INVALID_MAP_QUERY",
                        title: "Invalid request",
                        subtitle: "",
                        details: "The playUri query parameter is required.",
                    });
                    return;
                }

                let details;
                try {
                    details = buildMapDetails(query.data.playUri, this.configuration);
                } catch (error) {
                    // `new URL(playUri)` throws on a malformed value. Answer a typed error the pusher can render
                    // instead of a 500, which would surface to the user as a blank "invalid server response".
                    // Worth logging: a malformed playUri usually means a misconfigured URL on the play side.
                    console.warn(
                        `[${new Date().toISOString()}] Could not parse playUri "${query.data.playUri}"`,
                        error,
                    );
                    res.status(200).json({
                        status: "error",
                        type: "error",
                        code: "UNSUPPORTED_URL_FORMAT",
                        title: "Unsupported URL format",
                        subtitle: "",
                        details: `Could not parse playUri: ${query.data.playUri}`,
                    });
                    return;
                }

                res.status(200).json(details);
            } catch (error) {
                next(error);
            }
        });
    }
}

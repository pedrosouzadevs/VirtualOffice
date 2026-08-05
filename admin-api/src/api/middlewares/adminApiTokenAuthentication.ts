import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Paths under the `/api` mount that the pusher calls **without** an `Authorization` header.
 *
 * Verified in `AdminApi.fetchCapabilities` (play/src/pusher/services/AdminApi.ts): every other call passes
 * `headers: { Authorization: ADMIN_API_TOKEN }`, but the capabilities probe is issued with no request config at all.
 * Rejecting it with a 403 would throw inside `initialise()`, which retries forever, and the pusher would never open
 * its port — the same failure mode as answering 404 (ADR-0002, Trap #2).
 */
const UNAUTHENTICATED_PATHS: ReadonlySet<string> = new Set(["/capabilities"]);

/**
 * Compares two secrets without leaking their contents through timing.
 *
 * Hashing both sides first gives `timingSafeEqual` the equal-length buffers it demands and stops the comparison from
 * revealing the expected token's length, which a raw length check would.
 */
function secretsMatch(provided: string, expected: string): boolean {
    const providedDigest = createHash("sha256").update(provided).digest();
    const expectedDigest = createHash("sha256").update(expected).digest();

    return timingSafeEqual(providedDigest, expectedDigest);
}

/**
 * Guards the Admin API with the shared token the pusher sends.
 *
 * Mount it on `/api` so new endpoints are protected by default; opening one up requires adding it to
 * {@link UNAUTHENTICATED_PATHS} deliberately.
 *
 * The token arrives **raw**, with no `Bearer` prefix. Expecting `Bearer <token>` would reject every pusher call.
 */
export function adminApiTokenAuthentication(expectedToken: string): RequestHandler {
    return (req: Request, res: Response, next: NextFunction): void => {
        if (UNAUTHENTICATED_PATHS.has(req.path)) {
            next();
            return;
        }

        const providedToken = req.get("Authorization");

        if (providedToken === undefined || !secretsMatch(providedToken, expectedToken)) {
            res.status(403).json({
                status: "error",
                type: "error",
                code: "ADMIN_API_FORBIDDEN",
                title: "Forbidden",
                subtitle: "",
                details: "Missing or invalid Admin API token.",
            });
            return;
        }

        next();
    };
}

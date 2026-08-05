import type { NextFunction, Request, RequestHandler, Response } from "express";

/** Generous for people, useless for a script: a human logs in a handful of times an hour, not sixty. */
export const DEFAULT_LOGIN_ATTEMPTS = 10;
export const DEFAULT_LOGIN_WINDOW_MS = 60_000;

/** Above this many tracked clients, sweep expired windows. Bounds the map without a timer. */
const SWEEP_THRESHOLD = 1_000;

interface Window {
    count: number;
    /** Epoch milliseconds at which this window stops counting. */
    resetsAt: number;
}

export interface LoginRateLimitOptions {
    readonly maxAttempts?: number;
    readonly windowMs?: number;
    /** Injected so the tests do not have to sleep out a window. */
    readonly now?: () => number;
}

/**
 * Caps how often one client may start a login.
 *
 * `/admin/login` answers with a redirect to the identity provider, so an unthrottled one is a small amplifier
 * pointed at that provider — and, once the dashboard is reachable from the internet, pointed there by anybody
 * (ADR-0004, decision #7).
 *
 * In-memory and therefore per-replica: N replicas allow N times the rate. That is the right trade for a
 * rate limit whose job is to stop a script, not to enforce an exact quota — a shared counter would put Redis
 * between a person and their login screen.
 */
export function loginRateLimit(options: LoginRateLimitOptions = {}): RequestHandler {
    const maxAttempts = options.maxAttempts ?? DEFAULT_LOGIN_ATTEMPTS;
    const windowMs = options.windowMs ?? DEFAULT_LOGIN_WINDOW_MS;
    const clock = options.now ?? (() => Date.now());

    const windows = new Map<string, Window>();

    return (req: Request, res: Response, next: NextFunction): void => {
        const now = clock();

        if (windows.size > SWEEP_THRESHOLD) {
            for (const [key, window] of windows) {
                if (window.resetsAt <= now) {
                    windows.delete(key);
                }
            }
        }

        // `req.ip` honours `trust proxy`, which matters behind Traefik: without it every request looks like it comes
        // from the proxy and one visitor's attempts would exhaust everyone's budget.
        const client = req.ip ?? "unknown";
        const existing = windows.get(client);
        const window =
            existing !== undefined && existing.resetsAt > now ? existing : { count: 0, resetsAt: now + windowMs };

        window.count += 1;
        windows.set(client, window);

        if (window.count > maxAttempts) {
            const retryAfterSeconds = Math.max(1, Math.ceil((window.resetsAt - now) / 1000));

            res.setHeader("Retry-After", String(retryAfterSeconds));
            res.status(429).json({
                status: "error",
                type: "error",
                code: "ADMIN_LOGIN_RATE_LIMITED",
                title: "Too many requests",
                subtitle: "",
                details: `Too many login attempts. Try again in ${retryAfterSeconds} seconds.`,
            });
            return;
        }

        next();
    };
}

import type { NextFunction, Request, RequestHandler, Response } from "express";
import { renewSession, verifySession, type AdminSession } from "../../Application/AdminSession";
import type { MemberRepository } from "../../Application/Ports/MemberRepository";
import type { Member } from "../../Domain/Member";
import { CSRF_HEADER, SESSION_COOKIE, setSessionCookies, type AdminCookieOptions } from "../AdminSessionCookies";

/**
 * The tag that opens the dashboard.
 *
 * The circularity is intentional: the tool that grants tags is protected by a tag it grants. What breaks the loop is
 * the idempotent bootstrap, which re-grants `ADMIN_API_BOOTSTRAP_ADMIN_EMAIL` on every startup (ADR-0002, decision #6).
 */
export const ADMIN_TAG = "admin";

/**
 * Paths under the `/admin` mount that must answer without a session.
 *
 * Same shape as the `/api` guard's allowlist, and for the same reason: everything is protected by default, and
 * opening one path is a deliberate edit here. These three cannot require a session — two of them are how you get one,
 * and the third has to work when the session is already gone.
 */
const UNAUTHENTICATED_PATHS: ReadonlySet<string> = new Set(["/login", "/callback", "/logout"]);

/** Methods that do not change state, and so need no CSRF token. Mirrors the safe-method list in RFC 9110. */
const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

declare module "express-serve-static-core" {
    interface Request {
        /** Set by {@link adminSessionAuthentication} once the session is valid *and* still carries the admin tag. */
        adminSession?: AdminSession;

        /**
         * The acting administrator, as the database has them right now.
         *
         * Attached because the barrier has just paid for the lookup, and because every mutation the dashboard grows
         * has to name its actor — in the answer today, in the audit log at G4.
         */
        adminMember?: Member;
    }
}

export interface AdminSessionAuthenticationDependencies {
    readonly sessionSecret: string;

    /** Consulted on **every** request: the cookie says who, the database says what they may do. */
    readonly members: MemberRepository;

    readonly cookieOptions: AdminCookieOptions;

    /** Injected so the sliding-window and expiry tests do not have to wait out a real hour. */
    readonly now?: () => Date;
}

function errorBody(code: string, title: string, details: string): Record<string, string> {
    return { status: "error", type: "error", code, title, subtitle: "", details };
}

/**
 * Requests under `/admin/api` are made by scripts, not navigations.
 *
 * Answering them with a redirect would hand the dashboard's fetch calls an HTML login page with a 200 on it, which
 * every caller would then try to parse as JSON (ADR-0004, mandatory test #1).
 */
function isProgrammaticRequest(req: Request): boolean {
    return req.path === "/api" || req.path.startsWith("/api/");
}

/**
 * What {@link authenticate} concluded.
 *
 * `admitted: false` means the response has already been written — a redirect, a 401 or a 403 — and the caller must
 * do nothing further.
 */
type AuthenticationOutcome =
    | { readonly admitted: true; readonly session: AdminSession; readonly member: Member }
    | { readonly admitted: false };

/**
 * Everything that needs to await: verify the cookie, check CSRF, re-read authorisation, renew if due.
 *
 * Separated from the handler so the request is only ever mutated synchronously, once, with the result.
 */
async function authenticate(
    req: Request,
    res: Response,
    dependencies: AdminSessionAuthenticationDependencies,
    now: Date,
): Promise<AuthenticationOutcome> {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    const session = typeof token === "string" ? await verifySession(token, dependencies.sessionSecret, now) : undefined;

    if (session === undefined) {
        // One answer for absent, expired, tampered and past-the-absolute-cap alike. A cookie that failed
        // verification is treated as no cookie: it must never be *re-read* to decide anything, which is how a
        // "refresh the expired session" path turns into a redirect loop (mandatory test #5).
        denyAnonymous(req, res);
        return { admitted: false };
    }

    if (!SAFE_METHODS.has(req.method) && req.get(CSRF_HEADER) !== session.csrfToken) {
        // Checked before the database is touched: a forged cross-site request should not cost a query.
        res.status(403).json(
            errorBody(
                "ADMIN_CSRF_FAILED",
                "Forbidden",
                `State-changing requests must carry the session's CSRF token in the ${CSRF_HEADER} header.`,
            ),
        );
        return { admitted: false };
    }

    const member = await dependencies.members.findByEmail(session.email);

    if (member === undefined || !member.tags.includes(ADMIN_TAG)) {
        // Re-read from the database rather than trusted from the token, so an administrator revoked mid session
        // loses access on their next click (ADR-0004, decision #2 and mandatory test #4).
        //
        // The cookie is deliberately left in place. Clearing it would send the next request back through the
        // provider — which still knows this person — only to refuse them again one round trip later.
        res.status(403).json(
            errorBody(
                "ADMIN_FORBIDDEN",
                "Forbidden",
                `The "${ADMIN_TAG}" tag is required to use the administration dashboard.`,
            ),
        );
        return { admitted: false };
    }

    const renewed = await renewSession(session, dependencies.sessionSecret, now);

    if (renewed !== undefined) {
        setSessionCookies(res, renewed.token, renewed.session, dependencies.cookieOptions);
    }

    return { admitted: true, session: renewed?.session ?? session, member };
}

/**
 * Guards the dashboard.
 *
 * Mount it on `/admin` so a route added later is protected before anyone remembers to protect it. It reads **only**
 * the session cookie: the `Authorization` header is never consulted here, which is what makes the pusher's
 * `ADMIN_API_TOKEN` useless against `/admin/*` (ADR-0004, decision #3).
 */
export function adminSessionAuthentication(dependencies: AdminSessionAuthenticationDependencies): RequestHandler {
    const clock = dependencies.now ?? (() => new Date());

    return (req: Request, res: Response, next: NextFunction): void => {
        if (UNAUTHENTICATED_PATHS.has(req.path)) {
            next();
            return;
        }

        authenticate(req, res, dependencies, clock())
            .then((outcome) => {
                if (!outcome.admitted) {
                    return;
                }

                req.adminSession = outcome.session;
                req.adminMember = outcome.member;
                next();
            })
            .catch((error: unknown) => {
                console.error(`[${new Date().toISOString()}] Failed to authenticate an admin session`, error);
                next(error);
            });
    };
}

function denyAnonymous(req: Request, res: Response): void {
    if (isProgrammaticRequest(req)) {
        res.status(401).json(
            errorBody("ADMIN_UNAUTHENTICATED", "Unauthorized", "A dashboard session is required for this endpoint."),
        );
        return;
    }

    // `originalUrl` rather than `path`: this middleware is mounted at `/admin`, so `path` has already had that prefix
    // stripped and would send the browser back to the wrong place after login.
    const returnTo = encodeURIComponent(req.originalUrl);

    res.redirect(302, `/admin/login?returnTo=${returnTo}`);
}

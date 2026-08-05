import type { CookieOptions, Response } from "express";
import { LOGIN_TRANSACTION_LIFETIME_SECONDS } from "../Application/AdminLoginTransaction";
import type { AdminSession } from "../Application/AdminSession";

/** The signed session. `HttpOnly`: nothing in the browser has any reason to read it. */
export const SESSION_COOKIE = "admin_session";

/** The pending OIDC login. Lives only between `/admin/login` and `/admin/callback`. */
export const LOGIN_TRANSACTION_COOKIE = "admin_login";

/**
 * The CSRF token, deliberately **not** `HttpOnly`: the dashboard's own scripts have to read it to echo it back in
 * {@link CSRF_HEADER}. It is not a secret in the way the session is — it is worthless without the session cookie,
 * and a cross-origin page can neither read it nor set the header.
 */
export const CSRF_COOKIE = "admin_csrf";

/** Where the CSRF token must come back. A custom header is precisely what an HTML form cannot send cross-origin. */
export const CSRF_HEADER = "x-csrf-token";

/**
 * Every dashboard cookie is scoped to this path.
 *
 * Structural reinforcement of ADR-0004 decision #3: a browser will not even offer these cookies to `/api/*`, so the
 * two credential spaces cannot overlap by accident.
 */
const COOKIE_PATH = "/admin";

export interface AdminCookieOptions {
    /**
     * Whether to mark cookies `Secure`.
     *
     * Derived from the public URL's scheme rather than from `NODE_ENV`: what matters is whether the browser will be
     * on HTTPS, and that is a property of the deployment's address, not of a build flag.
     */
    readonly secure: boolean;
}

/**
 * `SameSite=Lax`, not `Strict`.
 *
 * `Strict` looks like the stronger choice and would give CSRF protection for free, but browsers withhold `Strict`
 * cookies on requests that arrive through a cross-site redirect chain — which is exactly what returning from the
 * identity provider is. The result is a login that appears to succeed and then bounces straight back to the provider.
 * `Lax` already blocks cross-site POSTs; the explicit CSRF token (ADR-0004, decision #7) covers the rest.
 */
function baseOptions(options: AdminCookieOptions): CookieOptions {
    return {
        httpOnly: true,
        sameSite: "lax",
        secure: options.secure,
        path: COOKIE_PATH,
    };
}

/**
 * Writes the session and its CSRF companion.
 *
 * Both are session cookies with no `Max-Age` on purpose: the deadline that counts is inside the signed token, and a
 * cookie that outlived it would only produce confusing "logged in but refused" states.
 */
export function setSessionCookies(
    res: Response,
    token: string,
    session: AdminSession,
    options: AdminCookieOptions,
): void {
    res.cookie(SESSION_COOKIE, token, baseOptions(options));
    res.cookie(CSRF_COOKIE, session.csrfToken, { ...baseOptions(options), httpOnly: false });
}

export function clearSessionCookies(res: Response, options: AdminCookieOptions): void {
    res.clearCookie(SESSION_COOKIE, baseOptions(options));
    res.clearCookie(CSRF_COOKIE, { ...baseOptions(options), httpOnly: false });
}

export function setLoginTransactionCookie(res: Response, token: string, options: AdminCookieOptions): void {
    res.cookie(LOGIN_TRANSACTION_COOKIE, token, {
        ...baseOptions(options),
        maxAge: LOGIN_TRANSACTION_LIFETIME_SECONDS * 1000,
    });
}

export function clearLoginTransactionCookie(res: Response, options: AdminCookieOptions): void {
    res.clearCookie(LOGIN_TRANSACTION_COOKIE, baseOptions(options));
}

import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_RETURN_TO } from "../src/Application/AdminLoginTransaction";
import { CSRF_COOKIE, CSRF_HEADER, LOGIN_TRANSACTION_COOKIE, SESSION_COOKIE } from "../src/api/AdminSessionCookies";
import { loginRateLimit } from "../src/api/middlewares/loginRateLimit";
import { readCookieAttributes, readSetCookie, signInAs } from "./helpers/adminDashboard";
import { closeStartedServers, serveDashboardTestApp, testMember, type DashboardTestApp } from "./helpers/testApp";

afterEach(closeStartedServers);

const ADMIN_EMAIL = "john.doe@example.com";
const ADMIN = testMember(ADMIN_EMAIL, ["admin"]);
const T0 = new Date("2026-07-31T09:00:00.000Z");

const NO_REDIRECT = { redirect: "manual" } as const;

/** Starts a login and hands back the transaction cookie the provider's answer will have to arrive with. */
async function startLogin(app: DashboardTestApp, returnTo?: string): Promise<{ response: Response; cookie: string }> {
    const query = returnTo === undefined ? "" : `?returnTo=${encodeURIComponent(returnTo)}`;
    const response = await fetch(`${app.url}/admin/login${query}`, NO_REDIRECT);

    return { response, cookie: readSetCookie(response, LOGIN_TRANSACTION_COOKIE) ?? "" };
}

/** Plays back what the identity provider would send the browser to. */
function completeLogin(app: DashboardTestApp, transactionCookie: string): Promise<Response> {
    return fetch(`${app.url}/admin/callback?code=the-code&state=stub-state`, {
        headers: { Cookie: `${LOGIN_TRANSACTION_COOKIE}=${transactionCookie}` },
        ...NO_REDIRECT,
    });
}

describe("GET /admin/login", () => {
    it("sends the browser to the identity provider", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });

        const { response } = await startLogin(app);

        expect(response.status).toBe(302);
        expect(response.headers.get("location")).toBe(app.authenticator.authorizationUrl);
    });

    it("remembers the pending login in a short-lived HttpOnly cookie", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });

        const { response, cookie } = await startLogin(app);

        expect(cookie).not.toBe("");
        const attributes = readCookieAttributes(response, LOGIN_TRANSACTION_COOKIE);
        expect(attributes).toContain("httponly");
        expect(attributes).toContain("path=/admin");
        // `SameSite=Lax` is required, not incidental: the provider sends the browser back through a cross-site
        // navigation, and `Strict` would withhold the cookie exactly when the callback needs it.
        expect(attributes).toContain("samesite=lax");
        expect(attributes.some((attribute) => attribute.startsWith("max-age="))).toBe(true);
    });

    it("refuses to carry a destination that leaves the application", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });

        const { cookie } = await startLogin(app, "https://evil.example/steal");
        const callback = await completeLogin(app, cookie);

        expect(callback.headers.get("location")).toBe(DEFAULT_RETURN_TO);
    });

    it("carries an in-app destination through the whole round trip", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });

        const { cookie } = await startLogin(app, "/admin/members?search=ana");
        const callback = await completeLogin(app, cookie);

        expect(callback.headers.get("location")).toBe("/admin/members?search=ana");
    });

    it("rate-limits, so the redirect does not become an amplifier against the provider", async () => {
        // ADR-0004, decision #7: the moment the host is public, an unthrottled `/admin/login` points at the identity
        // provider on behalf of anybody who asks.
        const app = await serveDashboardTestApp({
            members: [ADMIN],
            now: T0,
            rateLimit: loginRateLimit({ maxAttempts: 2, windowMs: 60_000 }),
        });

        expect((await fetch(`${app.url}/admin/login`, NO_REDIRECT)).status).toBe(302);
        expect((await fetch(`${app.url}/admin/login`, NO_REDIRECT)).status).toBe(302);

        const limited = await fetch(`${app.url}/admin/login`, NO_REDIRECT);

        expect(limited.status).toBe(429);
        expect(limited.headers.get("retry-after")).toBeTruthy();
        expect(await limited.json()).toMatchObject({ code: "ADMIN_LOGIN_RATE_LIMITED" });
    });
});

describe("GET /admin/callback", () => {
    it("issues a session for an administrator", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });

        const { cookie } = await startLogin(app);
        const callback = await completeLogin(app, cookie);

        expect(callback.status).toBe(302);
        expect(callback.headers.get("location")).toBe(DEFAULT_RETURN_TO);
        expect(readSetCookie(callback, SESSION_COOKIE)).toBeTruthy();
        expect(readSetCookie(callback, CSRF_COOKIE)).toBeTruthy();
    });

    it("refuses a member without the admin tag, however well they authenticated (mandatory test #3)", async () => {
        // The provider answered *who*; the database answers *what they may do*. This split is the entire reason
        // authorisation was not left to an OIDC claim (ADR-0004, decision #2).
        const app = await serveDashboardTestApp({
            members: [testMember("alice.doe@example.com", ["editor"])],
            loginAs: "alice.doe@example.com",
            now: T0,
        });

        const { cookie } = await startLogin(app);
        const callback = await completeLogin(app, cookie);

        expect(callback.status).toBe(403);
        expect(await callback.json()).toMatchObject({ status: "error", code: "ADMIN_FORBIDDEN" });
        expect(readSetCookie(callback, SESSION_COOKIE)).toBeUndefined();
    });

    it("refuses somebody we have never seen", async () => {
        const app = await serveDashboardTestApp({ members: [], loginAs: "stranger@example.com", now: T0 });

        const { cookie } = await startLogin(app);
        const callback = await completeLogin(app, cookie);

        expect(callback.status).toBe(403);
        expect(readSetCookie(callback, SESSION_COOKIE)).toBeUndefined();
    });

    it("keys the session on the member's stored email, not the provider's casing", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], loginAs: "John.Doe@Example.COM", now: T0 });

        const { cookie } = await startLogin(app);
        const callback = await completeLogin(app, cookie);
        const sessionCookie = readSetCookie(callback, SESSION_COOKIE) ?? "";

        const me = await fetch(`${app.url}/admin/me`, { headers: { Cookie: `${SESSION_COOKIE}=${sessionCookie}` } });

        expect(me.status).toBe(200);
        expect(await me.json()).toMatchObject({ email: ADMIN_EMAIL });
    });

    it("rejects a callback that arrives with no pending login", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });

        const response = await fetch(`${app.url}/admin/callback?code=the-code&state=stub-state`, NO_REDIRECT);

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: "ADMIN_LOGIN_EXPIRED" });
    });

    it("rejects a tampered transaction cookie", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });

        const { cookie } = await startLogin(app);
        const response = await completeLogin(app, `${cookie}tampered`);

        expect(response.status).toBe(400);
        expect(readSetCookie(response, SESSION_COOKIE)).toBeUndefined();
    });

    it("rejects a login the person walked away from", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });

        const { cookie } = await startLogin(app);
        app.setNow(new Date(T0.getTime() + 11 * 60_000));

        expect((await completeLogin(app, cookie)).status).toBe(400);
    });

    it("turns a provider-side failure into a refusal, not a 500", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        app.authenticator.failure = new Error("state mismatch");

        const { cookie } = await startLogin(app);
        const response = await completeLogin(app, cookie);

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: "ADMIN_LOGIN_FAILED" });
    });

    it("spends the transaction cookie whatever the outcome", async () => {
        // A transaction is single-use. Leaving a spent one in the browser is what makes a replayed callback
        // interesting to an attacker.
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });

        const { cookie } = await startLogin(app);
        const success = await completeLogin(app, cookie);
        expect(readSetCookie(success, LOGIN_TRANSACTION_COOKIE)).toBe("");

        app.authenticator.failure = new Error("nope");
        const failure = await completeLogin(app, (await startLogin(app)).cookie);
        expect(readSetCookie(failure, LOGIN_TRANSACTION_COOKIE)).toBe("");
    });
});

describe("/admin/logout", () => {
    it("is not reachable by GET (mandatory test #9)", async () => {
        // A state-changing GET can be fired by an `<img>` tag on any page in the world.
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });

        const response = await fetch(`${app.url}/admin/logout`, NO_REDIRECT);

        expect(response.status).toBe(404);
    });

    it("rejects a POST that carries only the cookie", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await fetch(`${app.url}/admin/logout`, {
            method: "POST",
            headers: session.cookieOnlyHeaders,
        });

        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ code: "ADMIN_CSRF_FAILED" });
    });

    it("clears both cookies when the token matches", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await fetch(`${app.url}/admin/logout`, { method: "POST", headers: session.headers });

        expect(response.status).toBe(204);
        expect(readSetCookie(response, SESSION_COOKIE)).toBe("");
        expect(readSetCookie(response, CSRF_COOKIE)).toBe("");
    });

    it("is idempotent when there is nothing to log out of", async () => {
        // It has to answer once the session is already gone; that is why it is allowlisted out of the barrier.
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });

        const response = await fetch(`${app.url}/admin/logout`, { method: "POST" });

        expect(response.status).toBe(204);
    });

    it("ends the session it just cleared", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        await fetch(`${app.url}/admin/logout`, { method: "POST", headers: session.headers });

        // The browser has dropped the cookie; a request without it is anonymous again.
        const response = await fetch(`${app.url}/admin/me`, { ...NO_REDIRECT });
        expect(response.status).toBe(302);
    });
});

describe("GET /admin/me", () => {
    it("describes the acting administrator", async () => {
        const app = await serveDashboardTestApp({
            members: [testMember(ADMIN_EMAIL, ["admin", "editor"], "John Doe")],
            now: T0,
        });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await fetch(`${app.url}/admin/me`, { headers: session.headers });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            email: ADMIN_EMAIL,
            username: "John Doe",
            tags: ["admin", "editor"],
        });
    });

    it("never exposes the internal primary key", async () => {
        // The same rule the pusher-facing API follows: the email is the identifier that leaves this service, because
        // the front stores whatever we return as the owner of a personal area (ADR-0002, decision #5).
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const body: unknown = await (await fetch(`${app.url}/admin/me`, { headers: session.headers })).json();

        expect(body).not.toHaveProperty("id");
    });

    it("requires the CSRF header for nothing, being a read", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await fetch(`${app.url}/admin/me`, {
            headers: { ...session.cookieOnlyHeaders, [CSRF_HEADER]: "" },
        });

        expect(response.status).toBe(200);
    });
});

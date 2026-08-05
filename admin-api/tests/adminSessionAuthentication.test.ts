import { afterEach, describe, expect, it } from "vitest";
import { SESSION_LIFETIME_SECONDS } from "../src/Application/AdminSession";
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from "../src/api/AdminSessionCookies";
import { TEST_SESSION_SECRET, readSetCookie, signInAs } from "./helpers/adminDashboard";
import {
    TEST_ADMIN_API_TOKEN,
    closeStartedServers,
    serveDashboardTestApp,
    serveTestApp,
    testMember,
} from "./helpers/testApp";

afterEach(closeStartedServers);

const ADMIN_EMAIL = "john.doe@example.com";
const ADMIN = testMember(ADMIN_EMAIL, ["admin"]);
const T0 = new Date("2026-07-31T09:00:00.000Z");

/** Redirects must be inspected, never followed: the assertion is about the redirect itself. */
const NO_REDIRECT = { redirect: "manual" } as const;

describe("anonymous requests (ADR-0004, mandatory test #1)", () => {
    it("redirects a browser navigation to the login", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN] });

        const response = await fetch(`${app.url}/admin/`, NO_REDIRECT);

        expect(response.status).toBe(302);
        expect(response.headers.get("location")).toBe("/admin/login?returnTo=%2Fadmin%2F");
    });

    it("remembers where the person was going", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN] });

        const response = await fetch(`${app.url}/admin/members?search=ana`, NO_REDIRECT);

        expect(response.headers.get("location")).toBe("/admin/login?returnTo=%2Fadmin%2Fmembers%3Fsearch%3Dana");
    });

    it("answers /admin/api with 401 and never a redirect", async () => {
        // These are fetch calls, not navigations. A redirect would hand them an HTML login page under a 200 and
        // every caller would then fail parsing it as JSON.
        const app = await serveDashboardTestApp({ members: [ADMIN] });

        const response = await fetch(`${app.url}/admin/api/members`, NO_REDIRECT);

        expect(response.status).toBe(401);
        expect(response.headers.get("content-type")).toContain("application/json");
        expect(await response.json()).toMatchObject({ status: "error", code: "ADMIN_UNAUTHENTICATED" });
    });

    it("guards a route added under /admin later, by default", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN] });

        const response = await fetch(`${app.url}/admin/some/screen/added/later`, NO_REDIRECT);

        expect(response.status).toBe(302);
    });

    it("does not guard the three routes that cannot require a session", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN] });

        // /login redirects to the provider, not back to itself; /logout answers; neither demands a session.
        const login = await fetch(`${app.url}/admin/login`, NO_REDIRECT);
        const logout = await fetch(`${app.url}/admin/logout`, { method: "POST", ...NO_REDIRECT });

        expect(login.headers.get("location")).toContain("oidc.workadventure.localhost");
        expect(logout.status).toBe(204);
    });
});

describe("credential isolation (ADR-0004, mandatory test #2)", () => {
    it("does not let the pusher's ADMIN_API_TOKEN open /admin", async () => {
        // The machine secret is shared with the pusher. A token that also minted dashboard access would put "serve
        // the pusher" and "grant anyone any permission" one leak apart (ADR-0004, decision #2).
        const app = await serveDashboardTestApp({ members: [ADMIN] });

        const response = await fetch(`${app.url}/admin/me`, {
            headers: { Authorization: TEST_ADMIN_API_TOKEN },
            ...NO_REDIRECT,
        });

        expect(response.status).toBe(302);
        expect(response.headers.get("location")).toContain("/admin/login");
    });

    it("does not let the pusher's ADMIN_API_TOKEN open /admin/api either", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN] });

        const response = await fetch(`${app.url}/admin/api/members`, {
            headers: { Authorization: TEST_ADMIN_API_TOKEN },
            ...NO_REDIRECT,
        });

        expect(response.status).toBe(401);
    });

    it("does not let a dashboard session open /api", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN] });
        const session = await signInAs(ADMIN_EMAIL);

        const response = await fetch(`${app.url}/api/room/access`, { headers: session.headers });

        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ status: "error", code: "ADMIN_API_FORBIDDEN" });
    });

    it("still lets the pusher's token through on /api while the dashboard is mounted", async () => {
        // The dashboard must be additive. `/api/*` is what `play` depends on, and its retry loop turns any
        // regression here into a `play` that never opens its port (ADR-0002, Trap #2).
        const app = await serveDashboardTestApp({ members: [ADMIN] });

        const response = await fetch(`${app.url}/api/capabilities`);

        expect(response.status).toBe(200);
    });
});

describe("the admin tag is re-read on every request (ADR-0004, mandatory test #4)", () => {
    it("admits a member who holds the tag", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await fetch(`${app.url}/admin/me`, { headers: session.headers });

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ email: ADMIN_EMAIL, tags: ["admin"] });
    });

    it("denies the very next request once the tag is revoked", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        expect((await fetch(`${app.url}/admin/me`, { headers: session.headers })).status).toBe(200);

        // Revoked in the database while the cookie is untouched and still perfectly valid.
        app.members.replaceAll([testMember(ADMIN_EMAIL, [])]);

        const response = await fetch(`${app.url}/admin/me`, { headers: session.headers });

        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ status: "error", code: "ADMIN_FORBIDDEN" });
    });

    it("denies someone whose member row disappeared entirely", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        app.members.replaceAll([]);

        expect((await fetch(`${app.url}/admin/me`, { headers: session.headers })).status).toBe(403);
    });

    it("refuses without redirecting, so a revoked administrator does not bounce through the provider", async () => {
        const app = await serveDashboardTestApp({ members: [testMember(ADMIN_EMAIL, ["editor"])], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await fetch(`${app.url}/admin/`, { headers: session.headers, ...NO_REDIRECT });

        // 403, not 302: they are authenticated, they simply may not be here. Sending them to log in again would
        // succeed at the provider and land them right back on this same refusal.
        expect(response.status).toBe(403);
    });
});

describe("invalid cookies (ADR-0004, mandatory test #5)", () => {
    it("treats a tampered cookie as anonymous", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await fetch(`${app.url}/admin/me`, {
            headers: { Cookie: `${SESSION_COOKIE}=${session.token}tampered` },
            ...NO_REDIRECT,
        });

        expect(response.status).toBe(302);
    });

    it("treats an expired cookie as anonymous", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        app.setNow(new Date(T0.getTime() + (SESSION_LIFETIME_SECONDS + 60) * 1000));

        const response = await fetch(`${app.url}/admin/me`, { headers: session.headers, ...NO_REDIRECT });

        expect(response.status).toBe(302);
    });

    it("answers 401 rather than a redirect when an invalid cookie reaches /admin/api", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });

        const response = await fetch(`${app.url}/admin/api/members`, {
            headers: { Cookie: `${SESSION_COOKIE}=not-a-token` },
            ...NO_REDIRECT,
        });

        expect(response.status).toBe(401);
    });

    it("does not loop: the login the browser is sent to is reachable with the bad cookie still set", async () => {
        // The failure mode this guards against is a barrier that redirects to a login which is itself guarded.
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const badCookie = { Cookie: `${SESSION_COOKIE}=not-a-token` };

        const first = await fetch(`${app.url}/admin/`, { headers: badCookie, ...NO_REDIRECT });
        expect(first.headers.get("location")).toBe("/admin/login?returnTo=%2Fadmin%2F");

        const second = await fetch(`${app.url}${first.headers.get("location")}`, {
            headers: badCookie,
            ...NO_REDIRECT,
        });

        // Off to the identity provider, not back to /admin/login.
        expect(second.status).toBe(302);
        expect(second.headers.get("location")).toContain("oidc.workadventure.localhost");
    });
});

describe("CSRF on mutations (ADR-0004, mandatory test #9)", () => {
    it("rejects a mutation carrying only the cookie", async () => {
        // Exactly what a cross-site form post achieves: the browser attaches the cookie, but nothing can set a
        // custom header from another origin.
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await fetch(`${app.url}/admin/api/members/someone/tags`, {
            method: "POST",
            headers: session.cookieOnlyHeaders,
        });

        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ status: "error", code: "ADMIN_CSRF_FAILED" });
    });

    it("rejects a mutation whose CSRF token belongs to another session", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);
        const other = await signInAs(ADMIN_EMAIL, T0);

        const response = await fetch(`${app.url}/admin/api/members/someone/tags`, {
            method: "POST",
            headers: { ...session.cookieOnlyHeaders, [CSRF_HEADER]: other.session.csrfToken },
        });

        expect(response.status).toBe(403);
    });

    it("lets a mutation with the matching token through the barrier", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        // An unmounted path on purpose: this test is about the barrier admitting the request, so it must not depend
        // on what any controller behind it happens to answer today.
        const response = await fetch(`${app.url}/admin/api/never/implemented`, {
            method: "POST",
            headers: session.headers,
        });

        // 404 from the application's own handler, not 403 from the guard: authentication and CSRF both passed and
        // there is simply nothing here.
        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({ code: "ADMIN_API_NOT_FOUND" });
    });

    it("asks nothing of safe methods", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await fetch(`${app.url}/admin/me`, { headers: session.cookieOnlyHeaders });

        expect(response.status).toBe(200);
    });

    it("publishes the CSRF token in a readable cookie and keeps the session in an HttpOnly one", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        // Force a renewal so the response carries both cookies.
        app.setNow(new Date(T0.getTime() + (SESSION_LIFETIME_SECONDS - 60) * 1000));
        const response = await fetch(`${app.url}/admin/me`, { headers: session.headers });

        const sessionCookie = response.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`)) ?? "";
        const csrfCookie = response.headers.getSetCookie().find((c) => c.startsWith(`${CSRF_COOKIE}=`)) ?? "";

        expect(sessionCookie.toLowerCase()).toContain("httponly");
        // The dashboard's own scripts have to read this one to echo it back in the header.
        expect(csrfCookie.toLowerCase()).not.toContain("httponly");
        expect(sessionCookie.toLowerCase()).toContain("samesite=lax");
        expect(sessionCookie.toLowerCase()).toContain("path=/admin");
    });
});

describe("sliding renewal over HTTP (ADR-0004, decision #6)", () => {
    it("leaves the cookie alone while more than half the lifetime remains", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        app.setNow(new Date(T0.getTime() + 10 * 60_000));
        const response = await fetch(`${app.url}/admin/me`, { headers: session.headers });

        expect(readSetCookie(response, SESSION_COOKIE)).toBeUndefined();
    });

    it("re-issues the cookie once activity brings it close to expiry", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        app.setNow(new Date(T0.getTime() + 40 * 60_000));
        const response = await fetch(`${app.url}/admin/me`, { headers: session.headers });

        const renewed = readSetCookie(response, SESSION_COOKIE);
        expect(renewed).toBeDefined();
        expect(renewed).not.toBe(session.token);
        // The CSRF token survives, so the copy the dashboard already holds keeps working.
        expect(readSetCookie(response, CSRF_COOKIE)).toBe(session.session.csrfToken);
    });
});

describe("the dashboard when it is not configured", () => {
    it("answers a uniform 503 on /admin and leaves /api untouched", async () => {
        // A dashboard misconfiguration must never become a pusher outage.
        const url = await serveTestApp();

        const dashboard = await fetch(`${url}/admin/`, NO_REDIRECT);
        const api = await fetch(`${url}/api/capabilities`);

        expect(dashboard.status).toBe(503);
        expect(await dashboard.json()).toMatchObject({ code: "ADMIN_DASHBOARD_DISABLED" });
        expect(api.status).toBe(200);
    });

    it("does not accept a session that would have been valid", async () => {
        const url = await serveTestApp();
        const session = await signInAs(ADMIN_EMAIL);

        expect(TEST_SESSION_SECRET).not.toBe("");
        expect((await fetch(`${url}/admin/me`, { headers: session.headers })).status).toBe(503);
    });
});

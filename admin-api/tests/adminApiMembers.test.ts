import { afterEach, describe, expect, it } from "vitest";
import { CSRF_HEADER, LOGIN_TRANSACTION_COOKIE, SESSION_COOKIE } from "../src/api/AdminSessionCookies";
import { readSetCookie, signInAs, type TestSession } from "./helpers/adminDashboard";
import {
    closeStartedServers,
    serveDashboardTestApp,
    testMember,
    TEST_ADMIN_API_TOKEN,
    type DashboardTestApp,
} from "./helpers/testApp";

afterEach(closeStartedServers);

const ADMIN_EMAIL = "john.doe@example.com";
const ADMIN = testMember(ADMIN_EMAIL, ["admin"], "John Doe");
const ALICE = testMember("alice.doe@example.com", ["editor"], "Alice Doe");
const T0 = new Date("2026-07-31T09:00:00.000Z");

/** The dashboard signed in, ready to mutate. Every test here acts as an administrator. */
async function asAdmin(app: DashboardTestApp): Promise<TestSession> {
    return signInAs(ADMIN_EMAIL, T0);
}

function mutate(
    app: DashboardTestApp,
    session: TestSession,
    method: "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
): Promise<Response> {
    return fetch(`${app.url}${path}`, {
        method,
        headers: {
            ...session.headers,
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

const read = (app: DashboardTestApp, session: TestSession, path: string): Promise<Response> =>
    fetch(`${app.url}${path}`, { headers: session.cookieOnlyHeaders });

describe("GET /admin/api/members", () => {
    it("lists everyone with their tags", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0 });
        const session = await asAdmin(app);

        const response = await read(app, session, "/admin/api/members");

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual([
            { email: ALICE.email, username: "Alice Doe", tags: ["editor"] },
            { email: ADMIN_EMAIL, username: "John Doe", tags: ["admin"] },
        ]);
    });

    it("returns tags on search too", async () => {
        // The whole reason `searchWithTags` exists: a permission screen that lists people without showing what they
        // may do is not a permission screen.
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0 });
        const session = await asAdmin(app);

        const response = await read(app, session, "/admin/api/members?search=alice");

        expect(await response.json()).toEqual([{ email: ALICE.email, username: "Alice Doe", tags: ["editor"] }]);
    });

    it("treats an empty search as 'everyone', unlike the pusher-facing endpoint", async () => {
        // That one feeds a picker that asks on every keystroke, including the one that clears the field. This one
        // opens as a list.
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0 });
        const session = await asAdmin(app);

        const body: unknown = await (await read(app, session, "/admin/api/members?search=")).json();

        expect(body).toHaveLength(2);
    });

    it("never exposes the internal primary key", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await asAdmin(app);

        const body = (await (await read(app, session, "/admin/api/members")).json()) as Record<string, unknown>[];

        expect(body[0]).not.toHaveProperty("id");
        expect(JSON.stringify(body)).not.toContain(ADMIN.id);
    });

    it("is refused without a session", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });

        const response = await fetch(`${app.url}/admin/api/members`, { redirect: "manual" });

        expect(response.status).toBe(401);
    });
});

describe("GET /admin/api/members/:email", () => {
    it("describes one member", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0 });
        const session = await asAdmin(app);

        const response = await read(app, session, `/admin/api/members/${encodeURIComponent(ALICE.email)}`);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ email: ALICE.email, username: "Alice Doe", tags: ["editor"] });
    });

    it("answers 404 for somebody we have never seen", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await asAdmin(app);

        const response = await read(app, session, "/admin/api/members/nobody@example.com");

        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({ code: "ADMIN_MEMBER_NOT_FOUND" });
    });
});

describe("POST /admin/api/members/:email/tags", () => {
    it("grants a tag and answers with the member as they now are", async () => {
        // A tag that is not `admin`: that one can only be granted with direct SQL (threat model, F1), and this test
        // is about the shape of an ordinary grant.
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0, tags: ["greeter", "editor"] });
        const session = await asAdmin(app);

        const response = await mutate(app, session, "POST", `/admin/api/members/${ALICE.email}/tags`, {
            tag: "greeter",
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            member: { email: ALICE.email, username: "Alice Doe", tags: ["editor", "greeter"] },
            createdTag: false,
        });
    });

    it("is idempotent", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0, tags: ["editor"] });
        const session = await asAdmin(app);

        await mutate(app, session, "POST", `/admin/api/members/${ALICE.email}/tags`, { tag: "editor" });
        const response = await mutate(app, session, "POST", `/admin/api/members/${ALICE.email}/tags`, {
            tag: "editor",
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ member: { tags: ["editor"] } });
    });

    it("reports a tag it had to create", async () => {
        // Tags are free text and case-sensitive, so "Admin" is a brand new label that grants nothing. Saying so is
        // what turns a typo into something visible at the click rather than at the next login.
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0, tags: ["admin"] });
        const session = await asAdmin(app);

        const response = await mutate(app, session, "POST", `/admin/api/members/${ALICE.email}/tags`, {
            tag: "Admin",
        });

        expect(await response.json()).toMatchObject({ createdTag: true, member: { tags: ["Admin", "editor"] } });
    });

    it("creates a member who has never logged in", async () => {
        // Preparing access ahead of someone's first login is the point; ADR-0003 made the CLI behave the same way.
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0, tags: ["editor"] });
        const session = await asAdmin(app);

        const response = await mutate(app, session, "POST", "/admin/api/members/newcomer@example.com/tags", {
            tag: "editor",
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            member: { email: "newcomer@example.com", username: null, tags: ["editor"] },
        });
    });

    it("normalises the email in the path", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0, tags: ["editor"] });
        const session = await asAdmin(app);

        const response = await mutate(app, session, "POST", "/admin/api/members/Alice.Doe@Example.COM/tags", {
            tag: "editor",
        });

        // The same member, not a second one created by the casing.
        expect(await response.json()).toMatchObject({ member: { email: ALICE.email } });
    });

    it("rejects an empty or oversized tag", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0 });
        const session = await asAdmin(app);

        const empty = await mutate(app, session, "POST", `/admin/api/members/${ALICE.email}/tags`, { tag: "   " });
        const huge = await mutate(app, session, "POST", `/admin/api/members/${ALICE.email}/tags`, {
            tag: "x".repeat(65),
        });

        expect(empty.status).toBe(400);
        expect(huge.status).toBe(400);
        expect(await empty.json()).toMatchObject({ code: "ADMIN_INVALID_TAG" });
    });

    it("is refused without the CSRF token", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0, tags: ["greeter"] });
        const session = await asAdmin(app);

        const response = await fetch(`${app.url}/admin/api/members/${ALICE.email}/tags`, {
            method: "POST",
            headers: { ...session.cookieOnlyHeaders, "Content-Type": "application/json" },
            body: JSON.stringify({ tag: "greeter" }),
        });

        expect(response.status).toBe(403);
        // The code matters: this must be the CSRF guard refusing, not the protected-tag rule.
        expect(await response.json()).toMatchObject({ code: "ADMIN_CSRF_FAILED" });
        // And nothing happened.
        expect(await (await read(app, session, `/admin/api/members/${ALICE.email}`)).json()).toMatchObject({
            tags: ["editor"],
        });
    });

    it("is refused when the pusher's token is offered instead of a session", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0, tags: ["greeter"] });

        const response = await fetch(`${app.url}/admin/api/members/${ALICE.email}/tags`, {
            method: "POST",
            headers: { Authorization: TEST_ADMIN_API_TOKEN, "Content-Type": "application/json" },
            body: JSON.stringify({ tag: "greeter" }),
            redirect: "manual",
        });

        expect(response.status).toBe(401);
    });
});

describe("DELETE /admin/api/members/:email/tags/:tag", () => {
    it("revokes a tag the member holds", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0 });
        const session = await asAdmin(app);

        const response = await mutate(app, session, "DELETE", `/admin/api/members/${ALICE.email}/tags/editor`);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            member: { email: ALICE.email, username: "Alice Doe", tags: [] },
            wasHeld: true,
        });
    });

    it("succeeds on a tag the member never held, and says so", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0, tags: ["admin"] });
        const session = await asAdmin(app);

        const response = await mutate(app, session, "DELETE", `/admin/api/members/${ALICE.email}/tags/admin`);

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ wasHeld: false, member: { tags: ["editor"] } });
    });

    it("distinguishes an unknown member from an unknown tag", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0 });
        const session = await asAdmin(app);

        const noMember = await mutate(app, session, "DELETE", "/admin/api/members/nobody@example.com/tags/editor");
        const noTag = await mutate(app, session, "DELETE", `/admin/api/members/${ALICE.email}/tags/nonexistent`);

        expect(noMember.status).toBe(404);
        expect(await noMember.json()).toMatchObject({ code: "ADMIN_MEMBER_NOT_FOUND" });
        expect(noTag.status).toBe(404);
        expect(await noTag.json()).toMatchObject({ code: "ADMIN_TAG_NOT_FOUND" });
    });

    it("lets an administrator remove their own admin tag", async () => {
        // Deliberately not blocked (ADR-0004, decision #8). The bootstrap re-grants on every startup, so a lockout is
        // a restart away — and a rule nobody expects is worse than a recovery path that already exists.
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await asAdmin(app);

        const response = await mutate(app, session, "DELETE", `/admin/api/members/${ADMIN_EMAIL}/tags/admin`);

        expect(response.status).toBe(200);
        // And the barrier refuses them from the very next request.
        expect((await read(app, session, "/admin/api/members")).status).toBe(403);
    });

    it("is refused without the CSRF token", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0 });
        const session = await asAdmin(app);

        const response = await fetch(`${app.url}/admin/api/members/${ALICE.email}/tags/editor`, {
            method: "DELETE",
            headers: session.cookieOnlyHeaders,
        });

        expect(response.status).toBe(403);
    });
});

describe("PATCH /admin/api/members/:email", () => {
    it("sets a display name", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0 });
        const session = await asAdmin(app);

        const response = await mutate(app, session, "PATCH", `/admin/api/members/${ALICE.email}`, {
            username: "Alice D.",
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            member: { email: ALICE.email, username: "Alice D.", tags: ["editor"] },
        });
    });

    it("clears the name with null or blank", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0 });
        const session = await asAdmin(app);

        const cleared = await mutate(app, session, "PATCH", `/admin/api/members/${ALICE.email}`, { username: null });
        expect(await cleared.json()).toMatchObject({ member: { username: null } });

        await mutate(app, session, "PATCH", `/admin/api/members/${ALICE.email}`, { username: "Alice" });
        const blanked = await mutate(app, session, "PATCH", `/admin/api/members/${ALICE.email}`, { username: "   " });

        // Blank stores null rather than a string of spaces, which would render as an invisible name.
        expect(await blanked.json()).toMatchObject({ member: { username: null } });
    });

    it("refuses to invent a member from a typo", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await asAdmin(app);

        const response = await mutate(app, session, "PATCH", "/admin/api/members/typo@example.com", {
            username: "Nobody",
        });

        expect(response.status).toBe(404);
    });

    it("rejects a body that is not a name", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0 });
        const session = await asAdmin(app);

        const missing = await mutate(app, session, "PATCH", `/admin/api/members/${ALICE.email}`, {});
        const wrongType = await mutate(app, session, "PATCH", `/admin/api/members/${ALICE.email}`, { username: 42 });

        expect(missing.status).toBe(400);
        expect(wrongType.status).toBe(400);
        expect(await missing.json()).toMatchObject({ code: "ADMIN_INVALID_MEMBER_UPDATE" });
    });
});

describe("what a grant is actually worth", () => {
    it("changes canEdit on the pusher-facing API (ADR-0004, mandatory test #7)", async () => {
        // The point of the whole feature, crossing both route spaces in one test: an administrator grants a tag
        // through the dashboard, and the pusher — a different consumer with a different credential — sees it.
        const app = await serveDashboardTestApp({ members: [ADMIN, testMember("bob@example.com", [])], now: T0 });
        const session = await asAdmin(app);

        const roomAccess = () =>
            fetch(
                `${app.url}/api/room/access?userIdentifier=bob@example.com` +
                    `&playUri=${encodeURIComponent("http://play.workadventure.localhost/~/maps/areas.wam")}` +
                    `&characterTextureIds[]=male1`,
                { headers: { Authorization: TEST_ADMIN_API_TOKEN } },
            );

        expect(await (await roomAccess()).json()).toMatchObject({ canEdit: false });

        await mutate(app, session, "POST", "/admin/api/members/bob@example.com/tags", { tag: "editor" });

        expect(await (await roomAccess()).json()).toMatchObject({ canEdit: true, tags: ["editor"] });
    });

    it("does not let an administrator create another one (supersedes mandatory test #10)", async () => {
        // ADR-0004's decision #8 originally made granting `admin` an ordinary tag grant, and mandatory test #10
        // asserted exactly that. Threat model finding F1 revised it: an attacker holding a session for a minute
        // could otherwise mint an administrator that outlives the session by years. The privilege now lives in SQL.
        const app = await serveDashboardTestApp({
            members: [ADMIN, ALICE],
            loginAs: ALICE.email,
            now: T0,
            tags: ["admin"],
        });
        const session = await asAdmin(app);

        const refused = await mutate(app, session, "POST", `/admin/api/members/${ALICE.email}/tags`, {
            tag: "admin",
        });

        expect(refused.status).toBe(403);
        expect(await refused.json()).toMatchObject({ code: "ADMIN_TAG_PROTECTED" });

        // And Alice still cannot get in, which is the property test #10 was really about.
        expect((await completeLoginAs(app)).status).toBe(403);
    });
});

/** Walks the OIDC round trip the stub provider serves, returning the callback's response. */
async function completeLoginAs(app: DashboardTestApp): Promise<Response> {
    const login = await fetch(`${app.url}/admin/login`, { redirect: "manual" });
    const transaction = readSetCookie(login, LOGIN_TRANSACTION_COOKIE) ?? "";

    return fetch(`${app.url}/admin/callback?code=the-code&state=stub-state`, {
        headers: { Cookie: `${LOGIN_TRANSACTION_COOKIE}=${transaction}` },
        redirect: "manual",
    });
}

describe("the CSRF header name is the one the dashboard will send", () => {
    it("accepts the documented header", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0, tags: ["admin"] });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await fetch(`${app.url}/admin/api/members/${ALICE.email}/tags`, {
            method: "POST",
            headers: {
                Cookie: `${SESSION_COOKIE}=${session.token}`,
                [CSRF_HEADER]: session.session.csrfToken,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ tag: "greeter" }),
        });

        expect(response.status).toBe(200);
    });
});

import { isFetchMemberDataByUuidResponse } from "@workadventure/messages";
import { afterEach, describe, expect, it } from "vitest";
import type { NewBan } from "../src/Domain/Ban";
import type { NewReport } from "../src/Domain/Report";
import { signInAs } from "./helpers/adminDashboard";
import {
    closeStartedServers,
    serveDashboardTestApp,
    StubWorldKicker,
    testMember,
    TEST_ADMIN_API_TOKEN,
} from "./helpers/testApp";

afterEach(closeStartedServers);

const ADMIN_EMAIL = "john.doe@example.com";
const ADMIN = testMember(ADMIN_EMAIL, ["admin"], "John Doe");
const T0 = new Date("2026-07-31T09:00:00.000Z");

const BAN: NewBan = {
    identifier: "troublemaker@example.com",
    displayName: "Trouble Maker",
    message: "User banned by admin john.doe@example.com",
    roomUrl: "/~/maps/office.wam",
    issuedBy: ADMIN_EMAIL,
};

const REPORT: NewReport = {
    reportedIdentifier: "troublemaker@example.com",
    reporterIdentifier: "alice.doe@example.com",
    comment: "Kept shouting in the meeting room",
    roomUrl: "/~/maps/office.wam",
};

describe("GET /admin/api/bans", () => {
    it("refuses an anonymous caller", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0, bans: [BAN] });

        expect((await fetch(`${app.url}/admin/api/bans`)).status).toBe(401);
    });

    it("refuses the pusher's token, which does not open the dashboard", async () => {
        // The two credentials never cross (ADR-0004, decision #3). Asserted again here because this endpoint is new.
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0, bans: [BAN] });

        const response = await fetch(`${app.url}/admin/api/bans`, {
            headers: { Authorization: TEST_ADMIN_API_TOKEN },
        });

        expect(response.status).toBe(401);
    });

    it("answers the bans, newest first", async () => {
        const app = await serveDashboardTestApp({
            members: [ADMIN],
            now: T0,
            bans: [BAN, { ...BAN, identifier: "someone.else@example.com", message: "Second" }],
        });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await fetch(`${app.url}/admin/api/bans`, { headers: session.cookieOnlyHeaders });

        expect(response.status).toBe(200);
        expect((await response.json()) as { identifier: string }[]).toMatchObject([
            { identifier: "someone.else@example.com" },
            { identifier: "troublemaker@example.com", displayName: "Trouble Maker", issuedBy: ADMIN_EMAIL },
        ]);
    });

    it("answers an empty list when nobody has been banned", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await fetch(`${app.url}/admin/api/bans`, { headers: session.cookieOnlyHeaders });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual([]);
    });

    it("refuses a limit that is not a positive integer", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await fetch(`${app.url}/admin/api/bans?limit=0`, { headers: session.cookieOnlyHeaders });

        expect(response.status).toBe(400);
    });

    it("has no way to lift a ban", async () => {
        // Issuing became a dashboard action (ADR-0006, decision #1); lifting deliberately did not. What lifting
        // *means* is still undecided, and a DELETE route would decide it by accident. Direct SQL, documented.
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0, bans: [BAN] });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const deleted = await fetch(`${app.url}/admin/api/bans/ban-0`, { method: "DELETE", headers: session.headers });

        expect(deleted.status).toBe(404);
        expect(app.bans.bans).toHaveLength(1);
    });
});

describe("POST /admin/api/bans (ADR-0006)", () => {
    const issue = (
        url: string,
        headers: Record<string, string>,
        body: Record<string, unknown> = { identifier: "victim@example.com", message: "No shouting" },
    ) =>
        fetch(`${url}/admin/api/bans`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

    it("refuses an anonymous caller, and the pusher's token does not open it", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });

        const anonymous = await issue(app.url, {});
        const pusherToken = await issue(app.url, { Authorization: TEST_ADMIN_API_TOKEN });

        expect(anonymous.status).toBe(401);
        expect(pusherToken.status).toBe(401);
        expect(app.bans.bans).toHaveLength(0);
    });

    it("refuses a session without the CSRF header, like every dashboard mutation", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await issue(app.url, session.cookieOnlyHeaders);

        expect(response.status).toBe(403);
        expect(app.bans.bans).toHaveLength(0);
    });

    it("records the ban, names the logged-in administrator in the audit log, and kicks", async () => {
        const kicker = new StubWorldKicker();
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0, kicker });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await issue(app.url, session.headers);

        expect(response.status).toBe(201);
        expect((await response.json()) as Record<string, unknown>).toMatchObject({
            ban: { identifier: "victim@example.com", message: "No shouting", issuedBy: ADMIN_EMAIL },
            kicked: true,
        });
        // The actor is the session's administrator — read by the barrier from the database, never from the body.
        expect(app.audit.entries).toMatchObject([
            { actorEmail: ADMIN_EMAIL, action: "member.banned", targetEmail: "victim@example.com" },
        ]);
        expect(kicker.kicks).toEqual([{ identifier: "victim@example.com", message: "No shouting" }]);
    });

    it("answers kicked: false when the channel is not configured, and the ban still lands", async () => {
        // Best-effort by contract: the ban is the record plus the closed door; the kick is a courtesy.
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await issue(app.url, session.headers);

        expect(response.status).toBe(201);
        expect((await response.json()) as Record<string, unknown>).toMatchObject({ kicked: false });
        expect(app.bans.bans).toHaveLength(1);
    });

    it("answers kicked: false when delivery fails, and the ban still lands", async () => {
        const kicker = new StubWorldKicker();
        kicker.delivered = false;
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0, kicker });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await issue(app.url, session.headers);

        expect((await response.json()) as Record<string, unknown>).toMatchObject({ kicked: false });
        expect(app.bans.bans).toHaveLength(1);
        expect(app.audit.entries).toHaveLength(1);
    });

    it("normalises the identifier and closes the very door the pusher knocks on", async () => {
        // End to end inside one process: the dashboard app also serves /api/*, so the ban issued here must make
        // /api/room/access — the endpoint the pusher calls on every connection — answer the error variant.
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        await issue(app.url, session.headers, { identifier: "Victim@Example.COM", message: "No shouting" });

        const door = await fetch(
            `${app.url}/api/room/access?userIdentifier=victim@example.com&playUri=http://play.workadventure.localhost/~/maps/office.wam&characterTextureIds=male1`,
            { headers: { Authorization: TEST_ADMIN_API_TOKEN } },
        );

        expect(door.status).toBe(200);

        const body = (await door.json()) as Record<string, unknown>;

        expect(isFetchMemberDataByUuidResponse.safeParse(body)).toMatchObject({ success: true });
        expect(body).toMatchObject({ status: "error", code: "USER_BANNED", subtitle: "No shouting" });
    });

    it("uses the in-world wording when the administrator writes no message", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await issue(app.url, session.headers, { identifier: "victim@example.com" });

        expect((await response.json()) as Record<string, unknown>).toMatchObject({
            ban: { message: "You have been banned by an admin" },
        });
    });

    it("puts the member's display name on the record when the identifier is somebody we know", async () => {
        const app = await serveDashboardTestApp({
            members: [ADMIN, testMember("victim@example.com", [], "Vic Tim")],
            now: T0,
        });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await issue(app.url, session.headers);

        expect((await response.json()) as Record<string, unknown>).toMatchObject({
            ban: { displayName: "Vic Tim" },
        });
    });

    it("refuses a request naming nobody", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await issue(app.url, session.headers, { message: "No target" });

        expect(response.status).toBe(400);
        expect(app.bans.bans).toHaveLength(0);
    });
});

describe("GET /admin/api/reports", () => {
    it("refuses an anonymous caller", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0, reports: [REPORT] });

        expect((await fetch(`${app.url}/admin/api/reports`)).status).toBe(401);
    });

    it("answers the reports, newest first, comment included", async () => {
        const app = await serveDashboardTestApp({
            members: [ADMIN],
            now: T0,
            reports: [REPORT, { ...REPORT, comment: "And again the next day" }],
        });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await fetch(`${app.url}/admin/api/reports`, { headers: session.cookieOnlyHeaders });

        expect(response.status).toBe(200);
        expect((await response.json()) as { comment: string }[]).toMatchObject([
            { comment: "And again the next day" },
            { comment: "Kept shouting in the meeting room", reporterIdentifier: "alice.doe@example.com" },
        ]);
    });

    it("answers an empty list when nothing has been reported", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await fetch(`${app.url}/admin/api/reports`, { headers: session.cookieOnlyHeaders });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual([]);
    });

    it("has no way to write or dismiss a report", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0, reports: [REPORT] });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const posted = await fetch(`${app.url}/admin/api/reports`, {
            method: "POST",
            headers: { ...session.headers, "Content-Type": "application/json" },
            body: JSON.stringify({ reportedIdentifier: "someone@example.com" }),
        });

        expect(posted.status).toBe(404);
        expect(app.reports.reports).toHaveLength(1);
    });

    it("stays readable to an administrator whose target was deleted", async () => {
        // Both identifiers are snapshots, so a report about somebody with no member row is a normal answer.
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0, reports: [REPORT] });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await fetch(`${app.url}/admin/api/reports`, { headers: session.cookieOnlyHeaders });

        expect((await response.json()) as { reportedIdentifier: string }[]).toMatchObject([
            { reportedIdentifier: "troublemaker@example.com" },
        ]);
    });
});

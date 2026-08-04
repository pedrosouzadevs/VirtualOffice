import { afterEach, describe, expect, it } from "vitest";
import type { NewBan } from "../src/Domain/Ban";
import type { NewReport } from "../src/Domain/Report";
import { signInAs } from "./helpers/adminDashboard";
import { closeStartedServers, serveDashboardTestApp, testMember, TEST_ADMIN_API_TOKEN } from "./helpers/testApp";

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

    it("has no way to issue or lift a ban", async () => {
        // Read-only in both directions (ADR-0005, H3). A dashboard that could ban would be a second way to do it with
        // a different audit story, and lifting is a decision P3 does not make.
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0, bans: [BAN] });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const posted = await fetch(`${app.url}/admin/api/bans`, {
            method: "POST",
            headers: { ...session.headers, "Content-Type": "application/json" },
            body: JSON.stringify({ identifier: "victim@example.com" }),
        });
        const deleted = await fetch(`${app.url}/admin/api/bans/ban-0`, { method: "DELETE", headers: session.headers });

        expect(posted.status).toBe(404);
        expect(deleted.status).toBe(404);
        expect(app.bans.bans).toHaveLength(1);
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

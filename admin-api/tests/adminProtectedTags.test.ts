import { afterEach, describe, expect, it } from "vitest";
import { ALERT_MARKER } from "../src/Infrastructure/Alerting/LoggingAdminAlerter";
import { signInAs, type TestSession } from "./helpers/adminDashboard";
import { closeStartedServers, serveDashboardTestApp, testMember, type DashboardTestApp } from "./helpers/testApp";

afterEach(closeStartedServers);

const ADMIN_EMAIL = "john.doe@example.com";
const ADMIN = testMember(ADMIN_EMAIL, ["admin"]);
const ALICE = testMember("alice.doe@example.com", ["editor"]);
const OTHER_ADMIN = "other@example.com";
const T0 = new Date("2026-07-31T09:00:00.000Z");

function grant(app: DashboardTestApp, session: TestSession, email: string, tag: string): Promise<Response> {
    return fetch(`${app.url}/admin/api/members/${encodeURIComponent(email)}/tags`, {
        method: "POST",
        headers: { ...session.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ tag }),
    });
}

function revoke(app: DashboardTestApp, session: TestSession, email: string, tag: string): Promise<Response> {
    return fetch(`${app.url}/admin/api/members/${encodeURIComponent(email)}/tags/${tag}`, {
        method: "DELETE",
        headers: session.headers,
    });
}

/**
 * Threat model finding F1: an attacker holding a dashboard session for a minute could otherwise grant `admin` to an
 * address they control. The session dies within twelve hours; the grant would not, so a temporary compromise became
 * permanent access.
 *
 * The privilege now lives in SQL, which is not something a stolen cookie can reach.
 */
describe("the admin tag cannot be granted through the application", () => {
    it("refuses the grant and changes nothing", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0, tags: ["admin"] });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await grant(app, session, ALICE.email, "admin");

        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ code: "ADMIN_TAG_PROTECTED" });
        expect((await app.members.findByEmail(ALICE.email))?.tags).toEqual(["editor"]);
    });

    it("records the attempt and raises an alert", async () => {
        // A refusal nobody hears about is only half of F1: the attempt itself is the signal.
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0, tags: ["admin"] });
        const session = await signInAs(ADMIN_EMAIL, T0);

        await grant(app, session, ALICE.email, "admin");

        expect(app.audit.entries[0]).toMatchObject({
            actorEmail: ADMIN_EMAIL,
            action: "tag.grant_refused",
            targetEmail: ALICE.email,
            details: { tag: "admin" },
        });
        expect(app.alerter.raised[0]).toMatchObject({
            kind: "admin.grant.refused",
            actor: ADMIN_EMAIL,
            target: ALICE.email,
        });
    });

    it("refuses it however it is spelled with surrounding space", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0, tags: ["admin"] });
        const session = await signInAs(ADMIN_EMAIL, T0);

        expect((await grant(app, session, ALICE.email, "  admin  ")).status).toBe(403);
    });

    it("still allows every other tag", async () => {
        // The rule is about one privilege, not about locking the dashboard. Everything else keeps working.
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await grant(app, session, ALICE.email, "greeter");

        expect(response.status).toBe(200);
        expect(app.alerter.raised).toEqual([]);
    });

    it("does not refuse a tag whose name merely contains admin", async () => {
        // `administrative` is not `admin`. A substring check here would quietly block ordinary tags.
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        expect((await grant(app, session, ALICE.email, "administrative")).status).toBe(200);
    });

    it("does not refuse adminMap, the structural-editing tag, despite its admin prefix", async () => {
        // adminMap unlocks tile editing (ADR-0007) and must stay grantable through the dashboard — that is how
        // an administrator gives it to themselves. It shares a prefix with the protected tag, nothing more.
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await grant(app, session, ALICE.email, "adminMap");

        expect(response.status).toBe(200);
        expect(app.alerter.raised).toEqual([]);
    });
});

describe("revoking admin stays possible", () => {
    it("is allowed, because removing an administrator is a safety action", async () => {
        // Needing a DBA to remove an administrator during an incident would be the wrong trade.
        const app = await serveDashboardTestApp({
            members: [ADMIN, testMember(OTHER_ADMIN, ["admin"])],
            now: T0,
        });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await revoke(app, session, OTHER_ADMIN, "admin");

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ wasHeld: true, member: { tags: [] } });
    });

    it("alerts, because the set of administrators shrinking is not a thing to discover by accident", async () => {
        const app = await serveDashboardTestApp({
            members: [ADMIN, testMember(OTHER_ADMIN, ["admin"])],
            now: T0,
        });
        const session = await signInAs(ADMIN_EMAIL, T0);

        await revoke(app, session, OTHER_ADMIN, "admin");

        expect(app.alerter.raised[0]).toMatchObject({
            kind: "admin.revoked",
            actor: ADMIN_EMAIL,
            target: OTHER_ADMIN,
        });
    });

    it("does not alert when the member never held it", async () => {
        // Nothing shrank. Alerting here would train people to ignore the channel.
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0, tags: ["admin"] });
        const session = await signInAs(ADMIN_EMAIL, T0);

        await revoke(app, session, ALICE.email, "admin");

        expect(app.alerter.raised).toEqual([]);
    });

    it("lets the last administrator remove themselves, which the bootstrap undoes on restart", async () => {
        // ADR-0004 decision #8 survives F1: lockout recovery is still a restart, because the bootstrap grants
        // through the repository rather than through this service.
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        expect((await revoke(app, session, ADMIN_EMAIL, "admin")).status).toBe(200);
        expect(app.alerter.raised[0]).toMatchObject({ kind: "admin.revoked", target: ADMIN_EMAIL });
    });
});

describe("alerting never breaks the request that triggered it", () => {
    it("still refuses the grant when the alert channel is down", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0, tags: ["admin"] });
        const session = await signInAs(ADMIN_EMAIL, T0);
        app.alerter.failing = true;

        const response = await grant(app, session, ALICE.email, "admin");

        // The refusal is the security property; the alert is only the notification about it.
        expect(response.status).toBe(403);
    });

    it("still revokes when the alert channel is down", async () => {
        const app = await serveDashboardTestApp({
            members: [ADMIN, testMember(OTHER_ADMIN, ["admin"])],
            now: T0,
        });
        const session = await signInAs(ADMIN_EMAIL, T0);
        app.alerter.failing = true;

        expect((await revoke(app, session, OTHER_ADMIN, "admin")).status).toBe(200);
    });

    it("uses a marker a log pipeline can match on", () => {
        // The cheapest deployment configures no webhook at all, so the log line has to be the alert.
        expect(ALERT_MARKER).toBe("[ADMIN-ALERT]");
    });
});

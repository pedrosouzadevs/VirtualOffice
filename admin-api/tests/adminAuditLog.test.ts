import { afterEach, describe, expect, it, vi } from "vitest";
import { signInAs, type TestSession } from "./helpers/adminDashboard";
import { closeStartedServers, serveDashboardTestApp, testMember, type DashboardTestApp } from "./helpers/testApp";

afterEach(closeStartedServers);

const ADMIN_EMAIL = "john.doe@example.com";
const ADMIN = testMember(ADMIN_EMAIL, ["admin"], "John Doe");
const ALICE = testMember("alice.doe@example.com", ["editor"], "Alice Doe");
const T0 = new Date("2026-07-31T09:00:00.000Z");

function mutate(
    app: DashboardTestApp,
    session: TestSession,
    method: "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
): Promise<Response> {
    return fetch(`${app.url}${path}`, {
        method,
        headers: { ...session.headers, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

describe("every mutation is recorded (ADR-0004, mandatory test #6)", () => {
    it("records a grant, naming the acting administrator", async () => {
        // Not `admin`: that one is refused before anything is written, and its own recording is covered in
        // `adminProtectedTags.test.ts`.
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0, tags: ["greeter"] });
        const session = await signInAs(ADMIN_EMAIL, T0);

        await mutate(app, session, "POST", `/admin/api/members/${ALICE.email}/tags`, { tag: "greeter" });

        expect(app.audit.entries).toHaveLength(1);
        expect(app.audit.entries[0]).toMatchObject({
            actorEmail: ADMIN_EMAIL,
            action: "tag.granted",
            targetEmail: ALICE.email,
            details: { tag: "greeter", createdTag: false },
        });
        expect(app.audit.entries[0]?.createdAt).toBeInstanceOf(Date);
        expect(app.audit.entries[0]?.id).toBeTruthy();
    });

    it("records that a grant had to create the tag", async () => {
        // The difference between granting a permission and inventing a label, and the question somebody will ask
        // when a tag turns out to grant nothing.
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        await mutate(app, session, "POST", `/admin/api/members/${ALICE.email}/tags`, { tag: "Greeter" });

        expect(app.audit.entries[0]?.details).toEqual({ tag: "Greeter", createdTag: true });
    });

    it("records a revoke, and whether the tag was actually held", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0, tags: ["admin"] });
        const session = await signInAs(ADMIN_EMAIL, T0);

        await mutate(app, session, "DELETE", `/admin/api/members/${ALICE.email}/tags/editor`);
        await mutate(app, session, "DELETE", `/admin/api/members/${ALICE.email}/tags/admin`);

        expect(app.audit.entries.map((entry) => [entry.action, entry.details])).toEqual([
            ["tag.revoked", { tag: "editor", wasHeld: true }],
            // Recorded although nothing changed: somebody asked for it, and that intent is what gets questioned.
            ["tag.revoked", { tag: "admin", wasHeld: false }],
        ]);
    });

    it("records a rename", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        await mutate(app, session, "PATCH", `/admin/api/members/${ALICE.email}`, { username: "Alice D." });

        expect(app.audit.entries[0]).toMatchObject({
            actorEmail: ADMIN_EMAIL,
            action: "member.renamed",
            targetEmail: ALICE.email,
            details: { username: "Alice D." },
        });
    });

    it("names the administrator who acted, not the one who was acted on", async () => {
        // The actor is read from the session barrier's own lookup. Confusing the two would make the log useless in
        // precisely the case it exists for: an administrator changing another administrator's access.
        const app = await serveDashboardTestApp({
            members: [ADMIN, testMember("second.admin@example.com", ["admin"])],
            now: T0,
            tags: ["admin"],
        });
        const session = await signInAs("second.admin@example.com", T0);

        await mutate(app, session, "DELETE", `/admin/api/members/${ADMIN_EMAIL}/tags/admin`);

        expect(app.audit.entries[0]).toMatchObject({
            actorEmail: "second.admin@example.com",
            targetEmail: ADMIN_EMAIL,
        });
    });

    it("writes nothing when the mutation itself was refused", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        // A CSRF failure, an unknown member and an invalid body: three refusals, no state change, no entries.
        await fetch(`${app.url}/admin/api/members/${ADMIN_EMAIL}/tags`, {
            method: "POST",
            headers: { ...session.cookieOnlyHeaders, "Content-Type": "application/json" },
            body: JSON.stringify({ tag: "editor" }),
        });
        await mutate(app, session, "PATCH", "/admin/api/members/nobody@example.com", { username: "Ghost" });
        await mutate(app, session, "POST", `/admin/api/members/${ADMIN_EMAIL}/tags`, { tag: "" });

        expect(app.audit.entries).toEqual([]);
    });

    it("does not fail the request when the log is unavailable", async () => {
        // The change already landed. Answering with an error would misdescribe the world, and the caller could not
        // act on it — so the failure is shouted into the logs instead.
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0, tags: ["greeter"] });
        const session = await signInAs(ADMIN_EMAIL, T0);
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        app.audit.failing = true;

        const response = await mutate(app, session, "POST", `/admin/api/members/${ALICE.email}/tags`, {
            tag: "greeter",
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ member: { tags: ["editor", "greeter"] } });
        expect(consoleError).toHaveBeenCalled();
        consoleError.mockRestore();
    });
});

describe("GET /admin/api/audit", () => {
    it("answers newest first", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0, tags: ["greeter"] });
        const session = await signInAs(ADMIN_EMAIL, T0);

        await mutate(app, session, "POST", `/admin/api/members/${ALICE.email}/tags`, { tag: "greeter" });
        await mutate(app, session, "PATCH", `/admin/api/members/${ALICE.email}`, { username: "Alice D." });

        const entries = (await (
            await fetch(`${app.url}/admin/api/audit`, { headers: session.cookieOnlyHeaders })
        ).json()) as { action: string }[];

        expect(entries.map((entry) => entry.action)).toEqual(["member.renamed", "tag.granted"]);
    });

    it("narrows to one member", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN, ALICE], now: T0, tags: ["greeter"] });
        const session = await signInAs(ADMIN_EMAIL, T0);

        await mutate(app, session, "POST", `/admin/api/members/${ALICE.email}/tags`, { tag: "greeter" });
        await mutate(app, session, "PATCH", `/admin/api/members/${ADMIN_EMAIL}`, { username: "John D." });

        const response = await fetch(`${app.url}/admin/api/audit?target=${encodeURIComponent(ALICE.email)}`, {
            headers: session.cookieOnlyHeaders,
        });
        const entries = (await response.json()) as { targetEmail: string }[];

        expect(entries).toHaveLength(1);
        expect(entries[0]?.targetEmail).toBe(ALICE.email);
    });

    it("rejects a nonsensical limit", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await fetch(`${app.url}/admin/api/audit?limit=0`, { headers: session.cookieOnlyHeaders });

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: "ADMIN_INVALID_AUDIT_QUERY" });
    });

    it("is refused without a session", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });

        expect((await fetch(`${app.url}/admin/api/audit`, { redirect: "manual" })).status).toBe(401);
    });

    it("has no way to write through it", async () => {
        // The log is written by the handlers that make the change. An endpoint anyone can post to is not evidence.
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await mutate(app, session, "POST", "/admin/api/audit", { action: "invented" });

        expect(response.status).toBe(404);
    });
});

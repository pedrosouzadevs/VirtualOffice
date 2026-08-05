import { AdminBannedData } from "@workadventure/messages";
import { afterEach, describe, expect, it } from "vitest";
import {
    closeStartedServers,
    serveTestApp,
    StubAuditLogRepository,
    StubBanRepository,
    TEST_ADMIN_API_TOKEN,
} from "./helpers/testApp";

const auth = { headers: { Authorization: TEST_ADMIN_API_TOKEN } };

const postAuth = {
    method: "POST",
    headers: { Authorization: TEST_ADMIN_API_TOKEN, "Content-Type": "application/json" },
};

/** The body `AdminApi.banUserByUuid` sends, field for field. */
const banBody = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
        uuidToBan: "troublemaker@example.com",
        playUri: "http://play.arqueum.localhost/~/maps/office.wam",
        name: "Trouble Maker",
        message: "User banned by admin john.doe@example.com",
        byUserUuid: "john.doe@example.com",
        ...overrides,
    });

afterEach(closeStartedServers);

describe("GET /api/ban", () => {
    it("requires the admin token", async () => {
        const url = await serveTestApp();

        const response = await fetch(`${url}/api/ban?token=someone@example.com&ipAddress=127.0.0.1&roomUrl=/~/a.wam`);

        expect(response.status).toBe(403);
    });

    it("answers both is_banned and message for somebody who is banned", async () => {
        const bans = new StubBanRepository([
            {
                identifier: "troublemaker@example.com",
                displayName: "Trouble Maker",
                message: "You have been banned by an admin",
                roomUrl: "/~/maps/office.wam",
                issuedBy: "john.doe@example.com",
            },
        ]);
        const url = await serveTestApp({ banRepository: bans });

        const response = await fetch(`${url}/api/ban?token=troublemaker@example.com&ipAddress=127.0.0.1`, auth);

        expect(response.status).toBe(200);
        // The very schema the pusher parses this with. `message` is required, which is what makes an answer of
        // `{ is_banned: true }` alone a silent failure (ADR-0005, correction #6).
        expect(AdminBannedData.parse(await response.json())).toEqual({
            is_banned: true,
            message: "You have been banned by an admin",
        });
    });

    it("answers both fields for somebody who is not banned, which is the path every user takes", async () => {
        const url = await serveTestApp();

        const response = await fetch(`${url}/api/ban?token=alice@example.com&ipAddress=127.0.0.1`, auth);

        expect(response.status).toBe(200);
        // The one that matters. A reply of `{ is_banned: false }` alone fails this parse for every single user.
        expect(AdminBannedData.parse(await response.json())).toEqual({ is_banned: false, message: "" });
    });

    it("reads the user from the token parameter, not from userUuid", async () => {
        // The pusher's own OpenAPI comment calls it "the uuid of the user"; the code sends `token`
        // (ADR-0005, correction #2). Reading the documented name answers "not banned" for everybody.
        const bans = new StubBanRepository([
            {
                identifier: "troublemaker@example.com",
                displayName: null,
                message: "Banned",
                roomUrl: "/~/a.wam",
                issuedBy: "john.doe@example.com",
            },
        ]);
        const url = await serveTestApp({ banRepository: bans });

        const byToken = await fetch(`${url}/api/ban?token=troublemaker@example.com`, auth);
        const byUserUuid = await fetch(
            `${url}/api/ban?userUuid=troublemaker@example.com&token=someone@example.com`,
            auth,
        );

        expect(await byToken.json()).toMatchObject({ is_banned: true });
        expect(await byUserUuid.json()).toMatchObject({ is_banned: false });
    });

    it("answers is_banned: false for an identifier nobody ever banned, rather than an error", async () => {
        // The same rule `/api/room/access` follows for an unknown visitor: failing here would deny every connection.
        const url = await serveTestApp();

        const response = await fetch(`${url}/api/ban?token=never-seen-before`, auth);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ is_banned: false, message: "" });
    });

    it("finds the ban whatever casing the identifier arrives in", async () => {
        const bans = new StubBanRepository([
            {
                identifier: "Trouble.Maker@Example.com",
                displayName: null,
                message: "Banned",
                roomUrl: "/~/a.wam",
                issuedBy: "john.doe@example.com",
            },
        ]);
        const url = await serveTestApp({ banRepository: bans });

        const response = await fetch(`${url}/api/ban?token=trouble.maker@example.com`, auth);

        expect(await response.json()).toMatchObject({ is_banned: true });
    });

    it("answers with the most recent message when somebody was banned more than once", async () => {
        const bans = new StubBanRepository([
            {
                identifier: "troublemaker@example.com",
                displayName: null,
                message: "First offence",
                roomUrl: "/~/a.wam",
                issuedBy: "john.doe@example.com",
            },
            {
                identifier: "troublemaker@example.com",
                displayName: null,
                message: "Second offence",
                roomUrl: "/~/b.wam",
                issuedBy: "john.doe@example.com",
            },
        ]);
        const url = await serveTestApp({ banRepository: bans });

        const response = await fetch(`${url}/api/ban?token=troublemaker@example.com`, auth);

        expect(await response.json()).toMatchObject({ message: "Second offence" });
    });

    it("does not write the ip address anywhere", async () => {
        // Decision #3: an IP address is personal data, it identifies a household rather than a person, and it is the
        // one field here that would arrive with a retention obligation attached. Accepted, used for nothing, dropped.
        const bans = new StubBanRepository();
        const audit = new StubAuditLogRepository();
        const url = await serveTestApp({ banRepository: bans, auditLog: audit });

        await fetch(`${url}/api/ban?token=troublemaker@example.com&ipAddress=203.0.113.42`, auth);
        await fetch(`${url}/api/ban`, { ...postAuth, body: banBody() });

        expect(JSON.stringify(bans.bans)).not.toContain("203.0.113.42");
        expect(JSON.stringify(audit.entries)).not.toContain("203.0.113.42");
    });

    it("refuses a check with no token at all", async () => {
        const url = await serveTestApp();

        const response = await fetch(`${url}/api/ban?ipAddress=127.0.0.1`, auth);

        expect(response.status).toBe(400);
    });
});

describe("POST /api/ban", () => {
    it("requires the admin token", async () => {
        const url = await serveTestApp();

        const response = await fetch(`${url}/api/ban`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: banBody(),
        });

        expect(response.status).toBe(403);
    });

    it("accepts the body the pusher sends, field for field, and records who issued it", async () => {
        const bans = new StubBanRepository();
        const url = await serveTestApp({ banRepository: bans });

        const response = await fetch(`${url}/api/ban`, { ...postAuth, body: banBody() });

        expect(response.status).toBe(200);
        expect(bans.bans).toMatchObject([
            {
                identifier: "troublemaker@example.com",
                displayName: "Trouble Maker",
                message: "User banned by admin john.doe@example.com",
                roomUrl: "http://play.arqueum.localhost/~/maps/office.wam",
                issuedBy: "john.doe@example.com",
            },
        ]);
    });

    it("makes the ban visible to the check that follows", async () => {
        const url = await serveTestApp();

        await fetch(`${url}/api/ban`, { ...postAuth, body: banBody() });
        const check = await fetch(`${url}/api/ban?token=troublemaker@example.com`, auth);

        expect(await check.json()).toEqual({
            is_banned: true,
            message: "User banned by admin john.doe@example.com",
        });
    });

    it("writes an audit entry naming the administrator who banned", async () => {
        const audit = new StubAuditLogRepository();
        const url = await serveTestApp({ auditLog: audit });

        await fetch(`${url}/api/ban`, { ...postAuth, body: banBody() });

        expect(audit.entries).toMatchObject([
            {
                actorEmail: "john.doe@example.com",
                action: "member.banned",
                targetEmail: "troublemaker@example.com",
                details: { roomUrl: "http://play.arqueum.localhost/~/maps/office.wam" },
            },
        ]);
    });

    it("still bans when the audit log is down", async () => {
        // The kick runs after this call returns. Failing it because the log could not be written would restore the
        // very bug P3 repairs, and for a reason the administrator can do nothing about.
        const audit = new StubAuditLogRepository();
        audit.failing = true;
        const bans = new StubBanRepository();
        const url = await serveTestApp({ auditLog: audit, banRepository: bans });

        const response = await fetch(`${url}/api/ban`, { ...postAuth, body: banBody() });

        expect(response.status).toBe(200);
        expect(bans.bans).toHaveLength(1);
    });

    it("bans on a body carrying nothing but the person to ban", async () => {
        // Everything else has a safe default on purpose: the pusher awaits this call before `emitBan`, so anything
        // refused here means the administrator watches nothing happen and the user stays in the room.
        const bans = new StubBanRepository();
        const url = await serveTestApp({ banRepository: bans });

        const response = await fetch(`${url}/api/ban`, {
            ...postAuth,
            body: JSON.stringify({ uuidToBan: "troublemaker@example.com" }),
        });

        expect(response.status).toBe(200);
        expect(bans.bans).toMatchObject([{ identifier: "troublemaker@example.com", displayName: null, message: "" }]);
    });

    it("refuses a request with nobody to ban", async () => {
        const url = await serveTestApp();

        const response = await fetch(`${url}/api/ban`, { ...postAuth, body: JSON.stringify({ playUri: "/~/a.wam" }) });

        expect(response.status).toBe(400);
    });
});

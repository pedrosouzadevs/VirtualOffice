import { afterEach, describe, expect, it } from "vitest";
import { closeStartedServers, serveTestApp, TEST_ADMIN_API_TOKEN } from "./helpers/testApp";

afterEach(closeStartedServers);

/**
 * `/api/capabilities` is deliberately public, so a guarded route is needed to exercise the guard. Any unknown path
 * under `/api` reaches the middleware before Express can 404 it, which is precisely the "protected by default"
 * property we want to prove.
 */
const GUARDED_PATH = "/api/room/access";

describe("adminApiTokenAuthentication", () => {
    it("rejects a request with no Authorization header", async () => {
        const url = await serveTestApp();

        const response = await fetch(`${url}${GUARDED_PATH}`);

        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ status: "error", code: "ADMIN_API_FORBIDDEN" });
    });

    it("rejects a wrong token", async () => {
        const url = await serveTestApp();

        const response = await fetch(`${url}${GUARDED_PATH}`, { headers: { Authorization: "wrong-token" } });

        expect(response.status).toBe(403);
    });

    it("rejects the correct token wrapped in a Bearer prefix", async () => {
        // The pusher sends the token raw. Accepting "Bearer <token>" would hide a misconfiguration on the play side
        // that must surface loudly instead.
        const url = await serveTestApp();

        const response = await fetch(`${url}${GUARDED_PATH}`, {
            headers: { Authorization: `Bearer ${TEST_ADMIN_API_TOKEN}` },
        });

        expect(response.status).toBe(403);
    });

    it("rejects a token that is a prefix of the expected one", async () => {
        const url = await serveTestApp();

        const response = await fetch(`${url}${GUARDED_PATH}`, {
            headers: { Authorization: TEST_ADMIN_API_TOKEN.slice(0, -1) },
        });

        expect(response.status).toBe(403);
    });

    it("lets the raw token through, and the request falls to the 404 handler rather than the guard", async () => {
        const url = await serveTestApp();

        const response = await fetch(`${url}${GUARDED_PATH}`, {
            headers: { Authorization: TEST_ADMIN_API_TOKEN },
        });

        // 404, not 403: authentication passed and no handler is mounted here yet (it arrives in P0/E5).
        expect(response.status).toBe(404);
        // JSON, not Express's default HTML: the pusher parses every response with zod.
        expect(response.headers.get("content-type")).toContain("application/json");
        expect(await response.json()).toMatchObject({ status: "error", code: "ADMIN_API_NOT_FOUND" });
    });

    it("guards any new endpoint under /api by default", async () => {
        const url = await serveTestApp();

        const response = await fetch(`${url}/api/some/endpoint/added/later`);

        expect(response.status).toBe(403);
    });

    it("does not guard paths outside /api", async () => {
        const url = await serveTestApp();

        const response = await fetch(`${url}/healthz`);

        expect(response.status).toBe(200);
    });
});

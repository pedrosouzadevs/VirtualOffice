import { afterEach, describe, expect, it } from "vitest";
import { closeStartedServers, serveTestApp, TEST_ADMIN_API_TOKEN } from "./helpers/testApp";

afterEach(closeStartedServers);

/**
 * A real, mounted endpoint, used to prove the guard actually protects the endpoints that matter.
 * (`/api/capabilities` cannot serve here: it is deliberately public.)
 */
const GUARDED_PATH = "/api/room/access";

/**
 * A path with no handler behind it. Requests still reach the middleware first, which is precisely the "protected by
 * default" property worth proving: an endpoint added later is guarded before anyone remembers to guard it.
 */
const UNMOUNTED_PATH = "/api/never/implemented";

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

    it("lets the raw token through to an unmounted path, which then falls to the 404 handler", async () => {
        const url = await serveTestApp();

        const response = await fetch(`${url}${UNMOUNTED_PATH}`, {
            headers: { Authorization: TEST_ADMIN_API_TOKEN },
        });

        // 404, not 403: authentication passed and there is simply no handler here.
        expect(response.status).toBe(404);
        // JSON, not Express's default HTML: the pusher parses every response with zod.
        expect(response.headers.get("content-type")).toContain("application/json");
        expect(await response.json()).toMatchObject({ status: "error", code: "ADMIN_API_NOT_FOUND" });
    });

    it("lets the raw token through to a real endpoint, which then handles the request itself", async () => {
        const url = await serveTestApp();

        // No query parameters, so the endpoint's own validation answers 400 — proof the guard let it through
        // rather than short-circuiting with 403.
        const response = await fetch(`${url}${GUARDED_PATH}`, {
            headers: { Authorization: TEST_ADMIN_API_TOKEN },
        });

        expect(response.status).toBe(400);
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

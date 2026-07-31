import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { signInAs } from "./helpers/adminDashboard";
import { closeStartedServers, serveDashboardTestApp, testMember } from "./helpers/testApp";

afterEach(closeStartedServers);

const ADMIN_EMAIL = "john.doe@example.com";
const ADMIN = testMember(ADMIN_EMAIL, ["admin"]);
const T0 = new Date("2026-07-31T09:00:00.000Z");

const NO_REDIRECT = { redirect: "manual" } as const;

/**
 * A stand-in for `dist-ui`.
 *
 * A fixture rather than the real build output: these tests are about the routing around the application, and they
 * must pass whether or not somebody has run `npm run ui:build` in this checkout.
 */
let uiDirectory: string;

beforeAll(() => {
    uiDirectory = mkdtempSync(join(tmpdir(), "admin-ui-"));
    writeFileSync(join(uiDirectory, "index.html"), "<!DOCTYPE html><title>dashboard</title><div id=app></div>");
    mkdirSync(join(uiDirectory, "assets"));
    writeFileSync(join(uiDirectory, "assets", "index.js"), "export const built = true;");
});

afterAll(() => {
    rmSync(uiDirectory, { recursive: true, force: true });
});

describe("serving the built dashboard", () => {
    it("answers /admin/ with the application shell", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0, uiDirectory });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await fetch(`${app.url}/admin/`, { headers: session.cookieOnlyHeaders });

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/html");
        expect(await response.text()).toContain("<div id=app>");
    });

    it("answers a client-side route with the same shell, so a reload does not 404", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0, uiDirectory });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await fetch(`${app.url}/admin/members/someone@example.com`, {
            headers: session.cookieOnlyHeaders,
        });

        expect(response.status).toBe(200);
        expect(await response.text()).toContain("dashboard");
    });

    it("serves static assets", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0, uiDirectory });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await fetch(`${app.url}/admin/assets/index.js`, { headers: session.cookieOnlyHeaders });

        expect(response.status).toBe(200);
        expect(await response.text()).toContain("built");
    });

    it("still sends an anonymous visitor to the login rather than handing over the shell", async () => {
        // An application shell that can only fail its first request is a worse answer than a redirect.
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0, uiDirectory });

        const response = await fetch(`${app.url}/admin/`, NO_REDIRECT);

        expect(response.status).toBe(302);
        expect(response.headers.get("location")).toContain("/admin/login");
    });
});

describe("the fallback never swallows the API", () => {
    it("leaves /admin/api answering JSON", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0, uiDirectory });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await fetch(`${app.url}/admin/api/members`, { headers: session.cookieOnlyHeaders });

        expect(response.headers.get("content-type")).toContain("application/json");
        expect(await response.json()).toEqual([{ email: ADMIN_EMAIL, username: null, tags: ["admin"] }]);
    });

    it("answers an unimplemented API path with a JSON 404, not the shell", async () => {
        // This is the trap the exclusion exists for: every caller under /admin/api parses JSON, so an HTML body
        // would surface as a parse error far from the missing route.
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0, uiDirectory });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await fetch(`${app.url}/admin/api/never/implemented`, {
            headers: session.cookieOnlyHeaders,
        });

        expect(response.status).toBe(404);
        expect(response.headers.get("content-type")).toContain("application/json");
        expect(await response.json()).toMatchObject({ code: "ADMIN_API_NOT_FOUND" });
    });

    it("keeps an anonymous /admin/api request on 401 rather than redirecting it", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0, uiDirectory });

        const response = await fetch(`${app.url}/admin/api/members`, NO_REDIRECT);

        expect(response.status).toBe(401);
    });

    it("leaves the pusher-facing API untouched", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0, uiDirectory });

        expect((await fetch(`${app.url}/api/capabilities`)).status).toBe(200);
    });
});

describe("when the dashboard has not been built", () => {
    it("keeps working, answering /admin/ with the JSON 404", async () => {
        // The API is useful without a screen, and refusing to start over an unbuilt front end would hang `play`.
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await fetch(`${app.url}/admin/`, { headers: session.cookieOnlyHeaders });

        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({ code: "ADMIN_API_NOT_FOUND" });
    });

    it("still serves /admin/me and /admin/api", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        expect((await fetch(`${app.url}/admin/me`, { headers: session.cookieOnlyHeaders })).status).toBe(200);
        expect((await fetch(`${app.url}/admin/api/tags`, { headers: session.cookieOnlyHeaders })).status).toBe(200);
    });
});

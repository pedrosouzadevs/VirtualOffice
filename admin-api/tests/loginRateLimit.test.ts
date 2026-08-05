import { afterEach, describe, expect, it } from "vitest";
import { loginRateLimit } from "../src/api/middlewares/loginRateLimit";
import { closeStartedServers, serveDashboardTestApp, testMember } from "./helpers/testApp";

afterEach(closeStartedServers);

const ADMIN = testMember("john.doe@example.com", ["admin"]);
const NO_REDIRECT = { redirect: "manual" } as const;

describe("loginRateLimit", () => {
    it("lets the budget refill once the window passes", async () => {
        let now = 1_000_000;
        const app = await serveDashboardTestApp({
            members: [ADMIN],
            rateLimit: loginRateLimit({ maxAttempts: 1, windowMs: 60_000, now: () => now }),
        });

        expect((await fetch(`${app.url}/admin/login`, NO_REDIRECT)).status).toBe(302);
        expect((await fetch(`${app.url}/admin/login`, NO_REDIRECT)).status).toBe(429);

        now += 60_001;

        // A limit that never refills would lock an administrator out of their own dashboard, which is a worse
        // outcome than the amplification it exists to prevent.
        expect((await fetch(`${app.url}/admin/login`, NO_REDIRECT)).status).toBe(302);
    });

    it("says how long to wait", async () => {
        let now = 1_000_000;
        const app = await serveDashboardTestApp({
            members: [ADMIN],
            rateLimit: loginRateLimit({ maxAttempts: 1, windowMs: 60_000, now: () => now }),
        });

        await fetch(`${app.url}/admin/login`, NO_REDIRECT);
        now += 30_000;
        const limited = await fetch(`${app.url}/admin/login`, NO_REDIRECT);

        expect(limited.headers.get("retry-after")).toBe("30");
    });

    it("does not stand between a logged-in administrator and the rest of the dashboard", async () => {
        // Only `/admin/login` talks to the identity provider, so only `/admin/login` is limited.
        const app = await serveDashboardTestApp({
            members: [ADMIN],
            rateLimit: loginRateLimit({ maxAttempts: 1, windowMs: 60_000 }),
        });

        await fetch(`${app.url}/admin/login`, NO_REDIRECT);
        await fetch(`${app.url}/admin/login`, NO_REDIRECT);

        const response = await fetch(`${app.url}/admin/me`, NO_REDIRECT);

        // Redirected to login because it is anonymous — not rate-limited.
        expect(response.status).toBe(302);
    });
});

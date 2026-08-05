import { afterEach, describe, expect, it } from "vitest";
import { signInAs } from "./helpers/adminDashboard";
import { closeStartedServers, serveDashboardTestApp, testMember } from "./helpers/testApp";

afterEach(closeStartedServers);

const ADMIN_EMAIL = "john.doe@example.com";
const ADMIN = testMember(ADMIN_EMAIL, ["admin"]);
const T0 = new Date("2026-07-31T09:00:00.000Z");

describe("GET /admin/api/tags", () => {
    it("answers the catalogue, sorted", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], tags: ["editor", "visitor"], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await fetch(`${app.url}/admin/api/tags`, { headers: session.cookieOnlyHeaders });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(["admin", "editor", "visitor"]);
    });

    it("includes a tag the dashboard has just created", async () => {
        // The picker exists to stop the free-text field from quietly producing "Admin" alongside "admin". It can only
        // do that if it sees tags the moment they are granted.
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        await fetch(`${app.url}/admin/api/members/someone@example.com/tags`, {
            method: "POST",
            headers: { ...session.headers, "Content-Type": "application/json" },
            body: JSON.stringify({ tag: "greeter" }),
        });

        const response = await fetch(`${app.url}/admin/api/tags`, { headers: session.cookieOnlyHeaders });

        expect(await response.json()).toEqual(["admin", "greeter"]);
    });

    it("is refused without a session", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });

        const response = await fetch(`${app.url}/admin/api/tags`, { redirect: "manual" });

        expect(response.status).toBe(401);
    });
});

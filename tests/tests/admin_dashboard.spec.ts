import { expect, test } from "@playwright/test";

/**
 * End-to-end proof of the administration dashboard (ADR-0004, G4): sign in through the identity provider, grant a tag
 * through the screen, and see that tag decide what `play` allows.
 *
 * The three halves each belong to somebody else — the OIDC mock authenticates, the dashboard authorises, and the
 * pusher-facing API is what `play` reads — so this is the only test that can prove they agree.
 */

const DASHBOARD = "http://admin-api.workadventure.localhost";
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN ?? "123";

/**
 * A member nothing else touches.
 *
 * Deliberately **not** `alice.doe@example.com`: `admin_api.spec.ts` uses her to assert that a member without a tag
 * has no map rights, and Playwright runs spec files in parallel. Granting her a tag here would fail that test from a
 * distance, in a way that looks like a flake.
 *
 * The member does not exist beforehand and is created by the grant itself, which is the documented behaviour: access
 * can be prepared before somebody's first login.
 */
const TARGET = "e2e-dashboard@example.com";

const ROOM = "http://play.workadventure.localhost/~/maps/areas.wam";

test.setTimeout(180_000);

test.describe("Administration dashboard @oidc @nomobile @nowebkit", () => {
    test.beforeEach("The dashboard is a desktop tool", ({ page }) => {
        test.skip(page.viewportSize()?.width !== undefined && (page.viewportSize()?.width ?? 0) < 800, "Desktop only");
    });

    test("signing in, granting a tag, and the tag deciding what play allows @oidc", async ({ page, request }) => {
        const canEdit = async (): Promise<boolean> => {
            const response = await request.get(`${DASHBOARD}/api/room/access`, {
                params: { userIdentifier: TARGET, playUri: ROOM, "characterTextureIds[]": "male1" },
                headers: { Authorization: ADMIN_API_TOKEN },
            });

            expect(response.status()).toBe(200);

            return ((await response.json()) as { canEdit: boolean }).canEdit;
        };

        // --- Sign in ------------------------------------------------------------------------------------------
        // Anonymous, so the barrier bounces us to the identity provider's own login form.
        await page.goto(`${DASHBOARD}/admin/`);

        await page.fill("#Input_Username", "User1", { timeout: 40_000 });
        await page.fill("#Input_Password", "pwd");
        await page.click('button:has-text("Login")', { timeout: 50_000 });

        // Back on the dashboard, identified from **our** database rather than from the OIDC claim.
        await expect(page.getByRole("heading")).toBeVisible({ timeout: 50_000 });
        await expect(page.getByText("john.doe@example.com").first()).toBeVisible({ timeout: 30_000 });

        try {
            // --- Before: the tag is not there and play says no ------------------------------------------------
            expect(await canEdit()).toBe(false);

            // --- Grant it through the screen ------------------------------------------------------------------
            await page.getByRole("searchbox").fill(TARGET);
            // The member does not exist yet, so the list is empty and the grant has to come from the API the screen
            // uses. Driving it through the page keeps the session cookie and the CSRF token in play, which is the
            // part worth proving.
            const granted = await page.evaluate(async (target: string) => {
                const csrf = document.cookie
                    .split("; ")
                    .find((cookie) => cookie.startsWith("admin_csrf="))
                    ?.slice("admin_csrf=".length);

                const response = await fetch(`/admin/api/members/${encodeURIComponent(target)}/tags`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf ?? "" },
                    body: JSON.stringify({ tag: "editor" }),
                });

                return { status: response.status, body: await response.json() };
            }, TARGET);

            expect(granted.status).toBe(200);
            expect(granted.body).toMatchObject({ member: { email: TARGET, tags: ["editor"] } });

            // The screen now shows what was granted.
            await page.getByRole("button", { name: /Atualizar|Refresh/ }).click();
            await expect(page.getByText(TARGET)).toBeVisible({ timeout: 20_000 });
            await expect(page.getByRole("button", { name: /Revogar editor|Revoke editor/ })).toBeVisible();

            // --- After: the same grant decides what play allows -----------------------------------------------
            expect(await canEdit()).toBe(true);

            // --- And it was recorded --------------------------------------------------------------------------
            const audit = await page.evaluate(async (target: string) => {
                const response = await fetch(`/admin/api/audit?target=${encodeURIComponent(target)}`);

                return (await response.json()) as { actorEmail: string; action: string; targetEmail: string }[];
            }, TARGET);

            expect(audit[0]).toMatchObject({
                actorEmail: "john.doe@example.com",
                action: "tag.granted",
                targetEmail: TARGET,
            });
        } finally {
            // Revoked whatever happened, so a second run starts from the same "before" as the first.
            await page.evaluate(async (target: string) => {
                const csrf = document.cookie
                    .split("; ")
                    .find((cookie) => cookie.startsWith("admin_csrf="))
                    ?.slice("admin_csrf=".length);

                await fetch(`/admin/api/members/${encodeURIComponent(target)}/tags/editor`, {
                    method: "DELETE",
                    headers: { "X-CSRF-Token": csrf ?? "" },
                });
            }, TARGET);
        }

        expect(await canEdit()).toBe(false);
    });

    test("an anonymous visitor is sent to the login rather than into the dashboard @oidc", async ({ request }) => {
        const response = await request.get(`${DASHBOARD}/admin/`, { maxRedirects: 0 });

        expect(response.status()).toBe(302);
        expect(response.headers().location).toContain("/admin/login");
    });

    test("the pusher's token does not open the dashboard @oidc", async ({ request }) => {
        // The other direction of ADR-0004 mandatory test #2, at the real HTTP boundary.
        const response = await request.get(`${DASHBOARD}/admin/api/members`, {
            headers: { Authorization: ADMIN_API_TOKEN },
            maxRedirects: 0,
        });

        expect(response.status()).toBe(401);
    });
});

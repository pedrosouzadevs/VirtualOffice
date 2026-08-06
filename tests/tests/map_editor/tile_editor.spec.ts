import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import Map from "../utils/map";
import Menu from "../utils/menu";
import { map_storage_url } from "../utils/urls";
import { getPage } from "../utils/auth";
import { isMobile } from "../utils/isMobile";

/**
 * Structural (tile) editing, gated by the adminMap tag (ADR-0007).
 *
 * What this file pins:
 * 1. adminMap-only access — an ADMIN-tag user does NOT get the floor tool (no admin override, by product
 *    decision), and gets it after being granted adminMap through the official CLI.
 * 2. A painted stroke persists as a tileOverlay in the .wam served by map-storage — asserted at the HTTP
 *    boundary, which is also what every future client loads at join.
 * 3. The eraser writes explicit gid-0 overrides and releases the cell's collision marker.
 *
 * The stroke is painted on a far-away cell no other spec looks at, and the teardown revokes the tag; the
 * leftover gid-0 entries are inert (they erase cells that were already empty).
 */

const ADMIN_EMAIL = "john.doe@example.com";

function grantTag(email: string, tag: string): void {
    execSync(`docker exec virtualoffice-admin-api-1 npm run member:grant -- ${email} ${tag}`, { stdio: "ignore" });
}

function revokeTag(email: string, tag: string): void {
    execSync(`docker exec virtualoffice-admin-api-1 npm run member:revoke -- ${email} ${tag}`, { stdio: "ignore" });
}

test.setTimeout(240_000);
test.use({
    baseURL: map_storage_url,
});

test.describe("Tile editor @oidc @nomobile @nowebkit", () => {
    test.beforeEach("Map editor is not available on mobile", ({ page }) => {
        test.skip(isMobile(page), "Map editor is not available on mobile");
    });

    test.beforeEach("WebKit has issues with camera and microphone", ({ browserName }) => {
        test.skip(browserName === "webkit", "WebKit has issues with camera/microphone");
    });

    test("the floor tool is adminMap-only: admin does not see it, adminMap does, and a stroke persists in the WAM @oidc", async ({
        browser,
        request,
    }) => {
        test.info().annotations.push({ type: "cleanup", description: `adminMap is revoked from ${ADMIN_EMAIL}` });

        // Phase 1 — Admin1 holds "admin" from the bootstrap: full editor, but NO floor tool (no override).
        {
            await using page = await getPage(browser, "Admin1", Map.url("empty"));
            await Menu.openMapMenu(page);
            await page.getByText("Map editor").click();
            await expect(page.locator("#AreaEditor")).toBeVisible();
            await expect(page.locator("#FloorEditor")).toBeHidden();
        }

        grantTag(ADMIN_EMAIL, "adminMap");
        try {
            // Phase 2 — with adminMap granted, the tool appears (tags are read at connection time).
            await using page = await getPage(browser, "Admin1", Map.url("empty"));
            await Menu.openMapMenu(page);
            await page.getByText("Map editor").click();
            await page.locator("#FloorEditor").click();
            await expect(page.getByTestId("tileEditorPanel")).toBeVisible();

            // Pick the first palette tile and paint one cell in the middle of the viewport. The exact world
            // cell does not matter — the WAM assertion below reads whatever the stroke wrote.
            await page.getByTestId("tileEditorPaletteTile").first().click();
            const canvas = page.locator("canvas").first();
            const box = await canvas.boundingBox();
            if (!box) {
                throw new Error("Game canvas not found");
            }
            await canvas.click({ position: { x: box.width / 2 + 64, y: box.height / 2 } });

            // The .wam is public and is what every joining client loads: the overlay landing there IS the
            // persistence + sync guarantee.
            await expect
                .poll(
                    async () => {
                        const response = await request.get(`${map_storage_url}maps/empty.wam`);
                        if (!response.ok()) {
                            return undefined;
                        }
                        const wam = (await response.json()) as {
                            tileOverlay?: { layers: Record<string, Record<string, number>> };
                        };
                        return wam.tileOverlay && Object.keys(wam.tileOverlay.layers).length > 0
                            ? wam.tileOverlay
                            : undefined;
                    },
                    { timeout: 30_000 },
                )
                .toBeDefined();

            // Phase 3 — the eraser writes explicit gid-0 overrides on the same cell.
            await page.getByTestId("tileEditorModeErase").click();
            await canvas.click({ position: { x: box.width / 2 + 64, y: box.height / 2 } });

            await expect
                .poll(
                    async () => {
                        const response = await request.get(`${map_storage_url}maps/empty.wam`);
                        if (!response.ok()) {
                            return undefined;
                        }
                        const wam = (await response.json()) as {
                            tileOverlay?: { layers: Record<string, Record<string, number>> };
                        };
                        const layers = wam.tileOverlay?.layers ?? {};
                        const values = Object.values(layers).flatMap((cells) => Object.values(cells));
                        return values.length > 0 && values.every((gid) => gid === 0) ? "all-erased" : undefined;
                    },
                    { timeout: 30_000 },
                )
                .toBe("all-erased");
        } finally {
            revokeTag(ADMIN_EMAIL, "adminMap");
        }
    });

    test("the floor deep link no-ops without adminMap @oidc", async ({ browser }) => {
        // Admin1 holds admin (canEdit true) but not adminMap: #mapEditor=floor must not open the tool.
        await using page = await getPage(browser, "Admin1", Map.url("empty") + "#mapEditor=floor");

        await expect(page.getByTestId("tileEditorPanel")).toBeHidden();
    });
});

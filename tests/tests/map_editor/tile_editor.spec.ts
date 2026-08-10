import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
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
 * 1. adminMap-only access — an EDITOR-tag user opens the editor but does NOT get the floor tool (no
 *    override, by product decision; the admin case is pinned by the canEditTiles unit suite), and gets it
 *    after being granted adminMap through the official CLI plus a fresh login.
 * 2. A painted stroke persists as a tileOverlay in the .wam served by map-storage — asserted at the HTTP
 *    boundary, which is also what every future client loads at join.
 * 3. The eraser writes explicit gid-0 overrides.
 *
 * Everything runs as Member1 (alice.doe), NOT as the bootstrap administrator: john.doe is the account
 * humans use on the shared dev stack, and a spec that grants/revokes his tags mid-run fights them (it also
 * fought this spec's own phase 1 the first time it ran). Tags stick to the LOGIN session, so the spec
 * deletes the cached storage state whenever the tag set changes.
 */

const MEMBER_EMAIL = "alice.doe@example.com";
const MEMBER_AUTH_STATE = "./.auth/Member1.json";
// Node does not resolve *.localhost names (browsers do), so hitting the hostname from the test runner
// fails with ENOTFOUND unless the machine's hosts file lists it. Traefik routes by Host header, so target
// the loopback directly and set the header — the same trick the deploy guide documents for tunnel-less
// smoke tests, and it keeps this spec portable across machines.
const MAP_STORAGE_HOST = new URL(map_storage_url).hostname;

type WamWithOverlay = { tileOverlay?: { layers: Record<string, Record<string, number>> } };

async function fetchEmptyWam(
    request: import("@playwright/test").APIRequestContext,
): Promise<WamWithOverlay | undefined> {
    const response = await request.get("http://127.0.0.1/maps/empty.wam", {
        headers: { Host: MAP_STORAGE_HOST },
    });
    if (!response.ok()) {
        return undefined;
    }
    return (await response.json()) as WamWithOverlay;
}

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

    test("the floor tool is adminMap-only: editor does not see it, adminMap does, and a stroke persists in the WAM @oidc", async ({
        browser,
        request,
    }) => {
        test.info().annotations.push({
            type: "cleanup",
            description: `editor and adminMap are revoked from ${MEMBER_EMAIL}`,
        });

        grantTag(MEMBER_EMAIL, "editor");
        rmSync(MEMBER_AUTH_STATE, { force: true });
        try {
            // Phase 1 — editor tag only: the full editor opens, but the floor tool is absent (no override).
            {
                await using page = await getPage(browser, "Member1", Map.url("empty"));
                await Menu.openMapMenu(page);
                await page.getByText("Map editor").click();
                await expect(page.locator("#AreaEditor")).toBeVisible();
                await expect(page.locator("#FloorEditor")).toBeHidden();
            }

            grantTag(MEMBER_EMAIL, "adminMap");
            // Tags stick to the LOGIN session, not the connection: force a fresh login or the tool never
            // appears. Mirrors the operational rule in MAP-STRUCTURAL-EDITING.md.
            rmSync(MEMBER_AUTH_STATE, { force: true });

            // Phase 2 — with adminMap granted and a fresh login, the tool appears.
            await using page = await getPage(browser, "Member1", Map.url("empty"));
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
                        const wam = await fetchEmptyWam(request);
                        return wam?.tileOverlay && Object.keys(wam.tileOverlay.layers).length > 0
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
                        const wam = await fetchEmptyWam(request);
                        const layers = wam?.tileOverlay?.layers ?? {};
                        const values = Object.values(layers).flatMap((cells) => Object.values(cells));
                        return values.length > 0 && values.every((gid) => gid === 0) ? "all-erased" : undefined;
                    },
                    { timeout: 30_000 },
                )
                .toBe("all-erased");
        } finally {
            revokeTag(MEMBER_EMAIL, "adminMap");
            revokeTag(MEMBER_EMAIL, "editor");
            // The cached session carries the granted tags; drop it so later suites start clean.
            rmSync(MEMBER_AUTH_STATE, { force: true });
        }
    });

    test("the floor deep link no-ops without adminMap @oidc", async ({ browser }) => {
        // An editor-tag user has the editor available (canEdit true) but no adminMap: the #mapEditor=floor
        // deep link must not open the tool. Self-contained on Member1 so the human-shared admin account is
        // never touched.
        grantTag(MEMBER_EMAIL, "editor");
        rmSync(MEMBER_AUTH_STATE, { force: true });
        try {
            await using page = await getPage(browser, "Member1", Map.url("empty") + "#mapEditor=floor");

            await expect(page.getByTestId("tileEditorPanel")).toBeHidden();
        } finally {
            revokeTag(MEMBER_EMAIL, "editor");
            rmSync(MEMBER_AUTH_STATE, { force: true });
        }
    });
});

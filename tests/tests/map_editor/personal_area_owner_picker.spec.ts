import { expect, test } from "@playwright/test";
import AreaAccessRights from "../utils/areaAccessRights";
import { getPage } from "../utils/auth";
import { isMobile } from "../utils/isMobile";
import Map from "../utils/map";
import { resetWamMaps } from "../utils/map-editor/uploader";
import { map_storage_url } from "../utils/urls";
import Menu from "../utils/menu";

/**
 * The personal area's "allowed user" picker, which is dead without an Admin API: `LocalAdmin.searchMembers` rejects,
 * so the field returns nothing however you type in it (Spec 0001, pending item #4).
 *
 * With `admin-api` serving `/api/members`, it performs a real search — which is what lets an administrator *assign*
 * ownership of an area instead of waiting for someone to walk in and claim it, the piece that makes F4 manageable.
 *
 * The member it finds is the one the bootstrap creates on every `admin-api` startup, so this needs no fixture.
 */
test.setTimeout(240_000);
test.use({
    baseURL: map_storage_url,
});

test.describe("Personal area owner picker @oidc @nomobile @nowebkit", () => {
    test.beforeEach("Map editor is not available on mobile", ({ page }) => {
        test.skip(isMobile(page), "Map editor is not available on mobile");
    });

    test.beforeEach("WebKit has issues with camera and microphone", ({ browserName }) => {
        test.skip(browserName === "webkit", "WebKit has issues with camera/microphone");
    });

    test("finds a member by email, which LocalAdmin never could @oidc", async ({ browser, request }) => {
        await resetWamMaps(request);
        await using page = await getPage(browser, "Admin1", Map.url("empty"));

        await Menu.openMapEditor(page);
        await AreaAccessRights.openAreaEditorAndAddArea(page);

        await page.getByTestId("personalAreaPropertyData").click();
        await page.getByTestId("accessClaimMode").selectOption({ label: "Static" });

        // Typing queries /api/members through the pusher on every keystroke.
        await page.getByTestId("memberAutoCompleteInput").fill("john.doe");

        await expect(page.getByText("john.doe@example.com")).toBeVisible();
    });

    test("offers nothing for a search that matches nobody @oidc", async ({ browser, request }) => {
        // Guards against the picker appearing to work because it echoes whatever is typed.
        await resetWamMaps(request);
        await using page = await getPage(browser, "Admin1", Map.url("empty"));

        await Menu.openMapEditor(page);
        await AreaAccessRights.openAreaEditorAndAddArea(page);

        await page.getByTestId("personalAreaPropertyData").click();
        await page.getByTestId("accessClaimMode").selectOption({ label: "Static" });

        await page.getByTestId("memberAutoCompleteInput").fill("nobody-by-this-name");

        await expect(page.getByText("nobody-by-this-name@")).toBeHidden();
    });
});

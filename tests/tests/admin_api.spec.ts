import { expect, test } from "@playwright/test";
import Map from "./utils/map";
import Menu from "./utils/menu";
import { getPage } from "./utils/auth";
import { isMobile } from "./utils/isMobile";

/**
 * End-to-end proof that authorisation comes from `admin-api`'s database rather than the OIDC claim
 * (ADR-0002, mandatory tests #2 and #3).
 *
 * The distinction matters because both users below carry a `tags` claim from the OIDC mock — `User1` has `admin`,
 * `User2` has `member`. The pusher **stops forwarding that claim** the moment `ADMIN_API_URL` is set
 * (`AdminApi.fetchMemberDataByUuid` never puts `tags` in the query string), so what these tests actually exercise is
 * the member row the idempotent bootstrap creates for `john.doe@example.com`.
 *
 * If `ADMIN_API_URL` is ever unset, these tests keep passing for the wrong reason: `LocalAdmin` would grant the same
 * access from the OIDC claim. That is why the first test asserts the Admin API is answering at all.
 */
test.setTimeout(240_000);

test.describe("Admin API @oidc @nomobile @nowebkit", () => {
    test.beforeEach("Map editor is not available on mobile", ({ page }) => {
        test.skip(isMobile(page), "Map editor is not available on mobile");
    });

    test.beforeEach("WebKit has issues with camera and microphone", ({ browserName }) => {
        test.skip(browserName === "webkit", "WebKit has issues with camera/microphone");
    });

    test("the Admin API is the one answering, and it declares its capabilities @oidc", async ({ request }) => {
        // Guards the two tests below from passing for the wrong reason. /api/capabilities is deliberately public:
        // the pusher calls it with no Authorization header at all.
        const response = await request.get("http://admin-api.workadventure.localhost/api/capabilities");

        expect(response.status()).toBe(200);
        expect(await response.json()).toMatchObject({ "api/woka/list": "v1" });
    });

    test("a member holding the admin tag in the database can open the map editor @oidc", async ({ browser }) => {
        // john.doe@example.com, granted "admin" by the bootstrap that runs on every admin-api startup.
        await using page = await getPage(browser, "Admin1", Map.url("empty"));

        await Menu.openMapMenu(page);

        await expect(page.getByText("Map editor")).toBeVisible();
    });

    test("a member with no tag in the database cannot @oidc", async ({ browser }) => {
        // alice.doe@example.com. She has a "member" tag in the OIDC claim, which is now ignored, and no member row.
        await using page = await getPage(browser, "Member1", Map.url("empty"));

        await Menu.openMapMenu(page);

        await expect(page.getByText("Map editor")).toBeHidden();
    });

    test("member search answers with the bootstrapped administrator @oidc", async ({ request }) => {
        // Backs the picker exercised in map_editor/personal_area_owner_picker.spec.ts, at the HTTP boundary.
        const response = await request.get("http://admin-api.workadventure.localhost/api/members", {
            params: { searchText: "john.doe" },
            headers: { Authorization: process.env.ADMIN_API_TOKEN ?? "123" },
        });

        expect(response.status()).toBe(200);
        expect(await response.json()).toContainEqual(expect.objectContaining({ id: "john.doe@example.com" }));
    });

    test("tag search answers with the tags the bootstrap creates @oidc", async ({ request }) => {
        const response = await request.get("http://admin-api.workadventure.localhost/api/world/tags", {
            headers: { Authorization: process.env.ADMIN_API_TOKEN ?? "123" },
        });

        expect(response.status()).toBe(200);
        expect(await response.json()).toEqual(expect.arrayContaining(["admin", "editor"]));
    });
});

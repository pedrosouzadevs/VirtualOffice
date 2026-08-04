import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import Map from "./utils/map";
import Menu from "./utils/menu";
import { getPage } from "./utils/auth";
import { isMobile } from "./utils/isMobile";
import { evaluateScript } from "./utils/scripting";
import { publicTestMapUrl } from "./utils/urls";

/**
 * Deletes every ban this suite issued.
 *
 * Not housekeeping — a correctness requirement since ADR-0006: `/api/room/access` refuses banned identifiers, so a
 * leftover ban on the shared `alice.doe@example.com` would lock Member1 out of every later suite, in a way that
 * looks like a login flake. Straight through the container because lifting a ban deliberately has no API.
 */
function deleteBansFor(identifier: string): void {
    execSync(
        `docker exec virtualoffice-admin-api-db-1 psql -U admin_api -d admin_api -c "delete from ban where identifier = '${identifier}'; delete from audit_log where target_email = '${identifier}' and action = 'member.banned';"`,
        { stdio: "ignore" },
    );
}

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

        // The whole map menu is gated on `mapMenuVisibleStore` (MapSubMenu.svelte), so a user without map rights has
        // no menu to open at all — asserting on its contents would just time out waiting for a button that is never
        // rendered.
        await expect(page.getByTestId("map-menu")).toBeHidden();
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

    /**
     * ADR-0005, mandatory test #10 — the failure P3 exists to repair.
     *
     * `handleBanPlayerMessage` awaits `banUserByUuid` and only then calls `emitBan`, the part that actually removes
     * the person. While `/api/ban` answered 404 the await threw, so the ban did nothing at all and the failure went
     * quietly to Sentry. This drives the whole path — front → pusher → us → back → the banned browser.
     *
     * **The ban is triggered through the scripting API, because `play` ships no UI that issues one.** The action menu
     * on a video box offers `#kickoff-user`, which removes somebody from the *meeting* (a space private event), and
     * `ActionMediaBox.svelte` carries a commented-out `ban()` marked `TODO: implement ban user`. The only sender of
     * `banPlayerMessage` today is `IframeListener`'s `banUser` event, so that is what an administrator's script uses
     * and what this test exercises. Everything after that line is the production path.
     */
    test("banning somebody actually removes them @oidc", async ({ browser, request }) => {
        test.info().annotations.push({ type: "cleanup", description: "bans for alice.doe@example.com are deleted" });
        const room = publicTestMapUrl("tests/E2E/empty.json", "admin_api_ban");

        // john.doe@example.com, holding "admin" from the bootstrap. `handleBanPlayerMessage` returns early for
        // anybody else, so the tag has to be real rather than claimed.
        await using admin = await getPage(browser, "Admin1", room);
        // alice.doe@example.com, in the same room — `emitBan` is addressed to the room the administrator is in.
        await using victim = await getPage(browser, "Member1", room);

        // The uuid is the **email**: `/api/room/access` answers `userUuid` with the identifier the pusher sent, and
        // that invariant is what the whole area rests on (ADR-0002, invariant #2).
        await evaluateScript(
            admin,
            async () =>
                await new Promise<void>((resolve) => {
                    window.parent.postMessage(
                        { type: "banUser", data: { uuid: "alice.doe@example.com", name: "Member1" } },
                        "*",
                    );
                    resolve();
                }),
        );

        // What the banned person sees: `GameScene.bannedUser` replaces the game with an error screen. Matched by
        // heading rather than by text, because the screen says "banned" three times over.
        await expect(victim.getByRole("heading", { name: "BANNED" })).toBeVisible({ timeout: 60_000 });
        await expect(victim.getByText("Code : USER_BANNED")).toBeVisible();

        // And the ban is a record, not an event that vanished. `GET /api/ban` has no caller in the pusher
        // (ADR-0005, correction #7), so it is asserted at the HTTP boundary rather than through a screen.
        const check = await request.get("http://admin-api.workadventure.localhost/api/ban", {
            params: { token: "alice.doe@example.com", ipAddress: "127.0.0.1", roomUrl: room },
            headers: { Authorization: process.env.ADMIN_API_TOKEN ?? "123" },
        });

        expect(check.status()).toBe(200);
        expect(await check.json()).toMatchObject({
            is_banned: true,
            message: "User banned by admin john.doe@example.com",
        });

        // Since ADR-0006 the door also refuses her: the very connection endpoint answers the error variant now.
        const door = await request.get("http://admin-api.workadventure.localhost/api/room/access", {
            params: { userIdentifier: "alice.doe@example.com", playUri: room, "characterTextureIds[]": "male1" },
            headers: { Authorization: process.env.ADMIN_API_TOKEN ?? "123" },
        });

        expect(door.status()).toBe(200);
        expect(await door.json()).toMatchObject({ status: "error", code: "USER_BANNED" });
    });

    test.afterEach(() => {
        // Always, pass or fail: a leftover ban would lock Member1 out of every later suite through the door.
        deleteBansFor("alice.doe@example.com");
    });
});

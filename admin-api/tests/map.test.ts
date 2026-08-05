import { isErrorApiErrorData, isMapDetailsData, isRoomRedirect } from "@workadventure/messages";
import { afterEach, describe, expect, it } from "vitest";
import { buildMapDetails } from "../src/Application/MapDetailsService";
import {
    closeStartedServers,
    serveTestApp,
    TEST_ADMIN_API_TOKEN,
    TEST_MAP_DETAILS_CONFIGURATION,
} from "./helpers/testApp";

const BASE = "http://play.arqueum.localhost";

const fetchMap = async (url: string, playUri: string) =>
    fetch(`${url}/api/map?playUri=${encodeURIComponent(playUri)}`, {
        headers: { Authorization: TEST_ADMIN_API_TOKEN },
    });

/**
 * Reproduces how the pusher reads our answer: `isMapDetailsData` first, then `isRoomRedirect`, then
 * `isErrorApiErrorData`. If all three fail it shows "Invalid server response" and the map never loads, so every
 * branch of the endpoint must land in exactly one of them.
 */
const classify = (body: unknown): "mapDetails" | "redirect" | "error" | "UNPARSEABLE" => {
    if (isMapDetailsData.safeParse(body).success) return "mapDetails";
    if (isRoomRedirect.safeParse(body).success) return "redirect";
    if (isErrorApiErrorData.safeParse(body).success) return "error";
    return "UNPARSEABLE";
};

afterEach(closeStartedServers);

describe("GET /api/map", () => {
    it("requires the admin token", async () => {
        const url = await serveTestApp();

        const response = await fetch(`${url}/api/map?playUri=${encodeURIComponent(`${BASE}/~/maps/areas.wam`)}`);

        expect(response.status).toBe(403);
    });

    it("answers 400 when playUri is missing", async () => {
        const url = await serveTestApp();

        const response = await fetch(`${url}/api/map`, { headers: { Authorization: TEST_ADMIN_API_TOKEN } });

        expect(response.status).toBe(400);
    });

    describe("every branch satisfies one of the three schemas the pusher tries", () => {
        it("map-storage room (/~/) → MapDetailsData", async () => {
            const url = await serveTestApp();

            const response = await fetchMap(url, `${BASE}/~/maps/areas.wam`);

            expect(response.status).toBe(200);
            expect(classify(await response.json())).toBe("mapDetails");
        });

        it("external map (/_/) → MapDetailsData", async () => {
            const url = await serveTestApp();

            const response = await fetchMap(url, `${BASE}/_/global/maps.workadventu.re/starter/map.json`);

            expect(classify(await response.json())).toBe("mapDetails");
        });

        it("root path → RoomRedirect", async () => {
            const url = await serveTestApp();

            const response = await fetchMap(url, `${BASE}/`);

            expect(classify(await response.json())).toBe("redirect");
        });

        it(".tmj under /~/ → RoomRedirect", async () => {
            const url = await serveTestApp();

            const response = await fetchMap(url, `${BASE}/~/maps/areas.tmj`);

            expect(classify(await response.json())).toBe("redirect");
        });

        it("unsupported path → ErrorApiErrorData", async () => {
            const url = await serveTestApp();

            const response = await fetchMap(url, `${BASE}/nonsense/path`);

            expect(classify(await response.json())).toBe("error");
        });

        it("unparseable playUri → ErrorApiErrorData rather than a 500", async () => {
            const url = await serveTestApp();

            const response = await fetchMap(url, "not-a-url");

            expect(response.status).toBe(200);
            expect(classify(await response.json())).toBe("error");
        });
    });

    describe("routing, ported from LocalAdmin.fetchMapDetails", () => {
        it("builds wamUrl from PUBLIC_MAP_STORAGE_URL and groups map-storage rooms under 'default'", () => {
            const details = buildMapDetails(`${BASE}/~/maps/areas.wam`, TEST_MAP_DETAILS_CONFIGURATION);

            expect(details).toMatchObject({
                wamUrl: "http://map-storage.arqueum.localhost/maps/areas.wam",
                mapUrl: undefined,
                group: "default",
            });
        });

        it("builds mapUrl from the URL protocol for external maps, with a null group", () => {
            const details = buildMapDetails(
                `${BASE}/_/global/maps.workadventu.re/starter/map.json`,
                TEST_MAP_DETAILS_CONFIGURATION,
            );

            expect(details).toMatchObject({
                mapUrl: "http://maps.workadventu.re/starter/map.json",
                wamUrl: undefined,
                group: null,
            });
        });

        it("redirects the root path to START_ROOM_URL", () => {
            const details = buildMapDetails(`${BASE}/`, TEST_MAP_DETAILS_CONFIGURATION);

            expect(details).toEqual({
                redirectUrl: `${BASE}/_/global/maps.workadventu.re/starter/map.json`,
            });
        });

        it("rewrites .tmj to .wam", () => {
            const details = buildMapDetails(`${BASE}/~/maps/areas.tmj`, TEST_MAP_DETAILS_CONFIGURATION);

            expect(details).toEqual({ redirectUrl: `${BASE}/~/maps/areas.wam` });
        });

        it("reports UNSUPPORTED_URL_FORMAT with the offending path", () => {
            const details = buildMapDetails(`${BASE}/nonsense/path`, TEST_MAP_DETAILS_CONFIGURATION);

            expect(details).toMatchObject({
                status: "error",
                code: "UNSUPPORTED_URL_FORMAT",
                details: "Unsupported path: /nonsense/path",
            });
        });
    });

    describe("fields that must NOT be emitted", () => {
        // These three are returned by LocalAdmin but absent from isMapDetailsData, so zod drops them. Emitting them
        // would be dead weight at best; asserting their absence documents that the omission is deliberate.
        it("omits canEdit: the map editor is unlocked by /api/room/access, not here", () => {
            const details = buildMapDetails(`${BASE}/~/maps/areas.wam`, TEST_MAP_DETAILS_CONFIGURATION);

            expect(details).not.toHaveProperty("canEdit");
        });

        it("omits loadingCowebsiteLogo, which the schema has no key for", () => {
            const details = buildMapDetails(`${BASE}/~/maps/areas.wam`, TEST_MAP_DETAILS_CONFIGURATION);

            expect(details).not.toHaveProperty("loadingCowebsiteLogo");
        });

        it("emits opidWokaNamePolicy, not LocalAdmin's misspelled opidUsernamePolicy", () => {
            const details = buildMapDetails(`${BASE}/~/maps/areas.wam`, TEST_MAP_DETAILS_CONFIGURATION);

            expect(details).not.toHaveProperty("opidUsernamePolicy");
            expect(details).toMatchObject({ opidWokaNamePolicy: "user_input" });
        });

        it("nulls opidWokaNamePolicy when the configured value is not a valid policy", () => {
            const details = buildMapDetails(`${BASE}/~/maps/areas.wam`, {
                ...TEST_MAP_DETAILS_CONFIGURATION,
                opidWokaNamePolicy: "bogus",
            });

            expect(details).toMatchObject({ opidWokaNamePolicy: null });
        });
    });

    describe("configuration reaches the payload", () => {
        it("maps DISABLE_ANONYMOUS onto authenticationMandatory", () => {
            const details = buildMapDetails(`${BASE}/~/maps/areas.wam`, {
                ...TEST_MAP_DETAILS_CONFIGURATION,
                disableAnonymous: true,
            });

            expect(details).toMatchObject({ authenticationMandatory: true });
        });

        it("carries the chat flags through", () => {
            const details = buildMapDetails(`${BASE}/~/maps/areas.wam`, {
                ...TEST_MAP_DETAILS_CONFIGURATION,
                enableChat: false,
                enableChatUpload: false,
            });

            expect(details).toMatchObject({ enableChat: false, enableChatUpload: false });
        });

        it("puts enableTutorial under metadata, where the front reads it", () => {
            const details = buildMapDetails(`${BASE}/~/maps/areas.wam`, {
                ...TEST_MAP_DETAILS_CONFIGURATION,
                enableTutorial: false,
            });

            expect(details).toMatchObject({ metadata: { enableTutorial: false } });
        });

        it("hides the recording button unless the whole S3 target is configured", () => {
            const hidden = buildMapDetails(`${BASE}/~/maps/areas.wam`, TEST_MAP_DETAILS_CONFIGURATION);
            const enabled = buildMapDetails(`${BASE}/~/maps/areas.wam`, {
                ...TEST_MAP_DETAILS_CONFIGURATION,
                recordingConfigured: true,
            });

            expect(hidden).toMatchObject({ recording: { buttonState: "hidden", disabledReason: null } });
            expect(enabled).toMatchObject({ recording: { buttonState: "enabled", disabledReason: null } });
        });

        it("ships the default metatags so tab titles do not change when the Admin API is switched on", () => {
            const details = buildMapDetails(`${BASE}/~/maps/areas.wam`, TEST_MAP_DETAILS_CONFIGURATION);

            expect(details).toMatchObject({
                metatags: { title: "ArqueumSpace", appName: "ArqueumSpace", shortAppName: "WA" },
            });
        });
    });
});

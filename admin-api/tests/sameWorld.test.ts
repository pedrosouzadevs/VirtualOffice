import { ShortMapDescriptionList } from "@workadventure/messages";
import { afterEach, describe, expect, it } from "vitest";
import { RoomCatalogueUnavailable, type RoomCatalogue } from "../src/Application/Ports/RoomCatalogue";
import type { Area, Room } from "../src/Domain/Room";
import { closeStartedServers, serveTestApp, TEST_ADMIN_API_TOKEN } from "./helpers/testApp";

const auth = { headers: { Authorization: TEST_ADMIN_API_TOKEN } };

const ROOM_URL = "http://play.workadventure.localhost/~/maps/office.wam";

/** A room as `map-storage` describes it, metadata and all. */
const office: Room = {
    path: "maps/office.wam",
    roomUrl: "/~/maps/office.wam",
    wamUrl: "http://map-storage.workadventure.localhost/maps/office.wam",
    name: "The office",
    description: "Where everybody sits",
    thumbnail: "http://example.com/office.png",
    copyright: "© ArqueumSpace",
    areasSearchable: 3,
    entitiesSearchable: 7,
};

/** A room that says nothing about itself, which every metadata field must tolerate. */
const bare: Room = {
    path: "maps/bare.wam",
    roomUrl: "/~/maps/bare.wam",
    wamUrl: "http://map-storage.workadventure.localhost/maps/bare.wam",
    name: "maps/bare.wam",
    description: undefined,
    thumbnail: undefined,
    copyright: undefined,
    areasSearchable: undefined,
    entitiesSearchable: undefined,
};

const catalogue = (rooms: Room[]): RoomCatalogue => ({
    listRooms: () => Promise.resolve(rooms),
    listAreas: (): Promise<Area[]> => Promise.resolve([]),
});

const failing: RoomCatalogue = {
    listRooms: () => Promise.reject(new RoomCatalogueUnavailable("map-storage could not be reached.")),
    listAreas: () => Promise.reject(new RoomCatalogueUnavailable("map-storage could not be reached.")),
};

afterEach(closeStartedServers);

describe("GET /api/room/sameWorld", () => {
    it("requires the admin token", async () => {
        const url = await serveTestApp({ roomCatalogue: catalogue([office]) });

        const response = await fetch(`${url}/api/room/sameWorld?roomUrl=${encodeURIComponent(ROOM_URL)}`);

        expect(response.status).toBe(403);
    });

    it("validates against the very zod schema the pusher parses it with, metadata included", async () => {
        const url = await serveTestApp({ roomCatalogue: catalogue([office, bare]) });

        const response = await fetch(`${url}/api/room/sameWorld?roomUrl=${encodeURIComponent(ROOM_URL)}`, auth);

        expect(response.status).toBe(200);

        const parsed = ShortMapDescriptionList.parse(await response.json());

        // The metadata fields travel at the *top level* of each entry, because `ShortMapDescription` merges
        // `WAMMetadata` rather than nesting it (ADR-0005, decision #5).
        expect(parsed[0]).toMatchObject({
            name: "The office",
            roomUrl: "/~/maps/office.wam",
            wamUrl: "http://map-storage.workadventure.localhost/maps/office.wam",
            description: "Where everybody sits",
            thumbnail: "http://example.com/office.png",
            copyright: "© ArqueumSpace",
            areasSearchable: 3,
            entitiesSearchable: 7,
        });
        expect(parsed[1]).toMatchObject({ name: "maps/bare.wam", roomUrl: "/~/maps/bare.wam" });
    });

    it("tolerates tags comma-joined into one parameter, and returns every room", async () => {
        // The opposite of `characterTextureIds`: the pusher joins tags with commas into a single parameter
        // (ADR-0005, correction #5). Nothing in our data model expresses "this room requires that tag", so the
        // parameter is parsed and ignored — which is what `LocalAdmin` does today (decision #5).
        const url = await serveTestApp({ roomCatalogue: catalogue([office, bare]) });

        const response = await fetch(
            `${url}/api/room/sameWorld?roomUrl=${encodeURIComponent(ROOM_URL)}&tags=editor,admin&bypassTagFilter=false`,
            auth,
        );

        expect(response.status).toBe(200);
        expect(ShortMapDescriptionList.parse(await response.json())).toHaveLength(2);
    });

    it("answers the same list whether or not the tag filter is bypassed", async () => {
        // `bypassTagFilter` arrives as the string "true"/"false", from `String(bypassTagFilter)`. Both answers are
        // every room, and that equality is the readable form of "the filter is not implemented".
        const url = await serveTestApp({ roomCatalogue: catalogue([office, bare]) });
        const query = `roomUrl=${encodeURIComponent(ROOM_URL)}&tags=`;

        const bypassed = await fetch(`${url}/api/room/sameWorld?${query}&bypassTagFilter=true`, auth);
        const filtered = await fetch(`${url}/api/room/sameWorld?${query}&bypassTagFilter=false`, auth);

        expect(await bypassed.json()).toEqual(await filtered.json());
    });

    it("answers an empty list, not an error, for a world with no rooms in it yet", async () => {
        const url = await serveTestApp({ roomCatalogue: catalogue([]) });

        const response = await fetch(`${url}/api/room/sameWorld?roomUrl=${encodeURIComponent(ROOM_URL)}`, auth);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual([]);
    });

    it("refuses a request with no room at all", async () => {
        const url = await serveTestApp({ roomCatalogue: catalogue([office]) });

        const response = await fetch(`${url}/api/room/sameWorld`, auth);

        expect(response.status).toBe(400);
    });

    it("says map-storage is down rather than answering that the world is empty", async () => {
        // An empty list would be a lie shaped like a success: a broadcast to the world would reach nobody and the
        // administrator would watch it succeed.
        const url = await serveTestApp({ roomCatalogue: failing });

        const response = await fetch(`${url}/api/room/sameWorld?roomUrl=${encodeURIComponent(ROOM_URL)}`, auth);

        expect(response.status).toBe(502);
        expect(await response.json()).toMatchObject({ code: "ADMIN_ROOMS_UNAVAILABLE" });
    });

    it("says the catalogue is not configured when INTERNAL_MAP_STORAGE_URL is unset", async () => {
        const url = await serveTestApp();

        const response = await fetch(`${url}/api/room/sameWorld?roomUrl=${encodeURIComponent(ROOM_URL)}`, auth);

        expect(response.status).toBe(501);
        expect(await response.json()).toMatchObject({ code: "ADMIN_ROOMS_NOT_CONFIGURED" });
    });
});

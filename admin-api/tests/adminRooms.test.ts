import { afterEach, describe, expect, it } from "vitest";
import { RoomCatalogueUnavailable, type RoomCatalogue } from "../src/Application/Ports/RoomCatalogue";
import type { Area, Room } from "../src/Domain/Room";
import { toAreas, toRooms } from "../src/Infrastructure/MapStorage/MapStorageRoomCatalogue";
import { signInAs } from "./helpers/adminDashboard";
import { closeStartedServers, serveDashboardTestApp, testMember } from "./helpers/testApp";

afterEach(closeStartedServers);

const ADMIN_EMAIL = "john.doe@example.com";
const ADMIN = testMember(ADMIN_EMAIL, ["admin"]);
const T0 = new Date("2026-07-31T09:00:00.000Z");

const PUBLIC_MAP_STORAGE = "http://map-storage.workadventure.localhost";

describe("toRooms", () => {
    it("builds the room, its in-world address and the absolute WAM url", () => {
        const rooms = toRooms(
            {
                version: "1.0.0",
                maps: {
                    "maps/areas.wam": {
                        mapUrl: "http://example.com/areas.tmj",
                        metadata: {
                            name: "Areas",
                            description: "A test map",
                            copyright: "© ArqueumSpace",
                            areasSearchable: 2,
                            entitiesSearchable: 5,
                        },
                    },
                },
            },
            PUBLIC_MAP_STORAGE,
        );

        expect(rooms).toEqual([
            {
                path: "maps/areas.wam",
                // The same shape LocalAdmin builds, so a link from the dashboard matches how `play` addresses it.
                roomUrl: "/~/maps/areas.wam",
                wamUrl: `${PUBLIC_MAP_STORAGE}/maps/areas.wam`,
                name: "Areas",
                description: "A test map",
                thumbnail: undefined,
                // Read though no dashboard screen shows them: `/api/room/sameWorld` answers the whole of
                // `WAMMetadata`, exactly as the `LocalAdmin` it replaces did (ADR-0005, H2).
                copyright: "© ArqueumSpace",
                areasSearchable: 2,
                entitiesSearchable: 5,
            },
        ]);
    });

    it("falls back to the path when a map has no name", () => {
        // A room is always identifiable by something. An unnamed one showing as blank would be unusable.
        const rooms = toRooms({ version: "1", maps: { "maps/nameless.wam": {} } }, PUBLIC_MAP_STORAGE);

        expect(rooms[0]?.name).toBe("maps/nameless.wam");
    });

    it("sorts by name", () => {
        const rooms = toRooms(
            {
                version: "1",
                maps: {
                    "b.wam": { metadata: { name: "Zulu" } },
                    "a.wam": { metadata: { name: "Alpha" } },
                },
            },
            PUBLIC_MAP_STORAGE,
        );

        expect(rooms.map((room) => room.name)).toEqual(["Alpha", "Zulu"]);
    });

    it("ignores fields it does not know about", () => {
        // The schema here is narrow on purpose: map-storage adding to its answer must never break this screen.
        const rooms = toRooms(
            {
                version: "1",
                maps: { "a.wam": { metadata: { name: "Alpha", somethingNew: 42 }, vendor: { anything: true } } },
                extra: "ignored",
            },
            PUBLIC_MAP_STORAGE,
        );

        expect(rooms[0]?.name).toBe("Alpha");
    });

    it("handles a base URL with a trailing slash without doubling it", () => {
        const rooms = toRooms({ version: "1", maps: { "a.wam": {} } }, `${PUBLIC_MAP_STORAGE}/`);

        expect(rooms[0]?.wamUrl).toBe(`${PUBLIC_MAP_STORAGE}/a.wam`);
    });

    it("degrades to the path when the public URL is not a URL at all", () => {
        // A misconfiguration, and still not a reason to fail the whole listing.
        const rooms = toRooms({ version: "1", maps: { "a.wam": {} } }, "");

        expect(rooms[0]?.wamUrl).toBe("a.wam");
    });

    it("refuses an answer it does not understand", () => {
        expect(() => toRooms({ nonsense: true }, PUBLIC_MAP_STORAGE)).toThrow(RoomCatalogueUnavailable);
        expect(() => toRooms("not json at all", PUBLIC_MAP_STORAGE)).toThrow(RoomCatalogueUnavailable);
    });

    it("answers an empty world with an empty list rather than an error", () => {
        expect(toRooms({ version: "1", maps: {} }, PUBLIC_MAP_STORAGE)).toEqual([]);
    });
});

/** A catalogue that answers whatever the test needs, so no map-storage has to be running. */
class StubRoomCatalogue implements RoomCatalogue {
    /** Recorded so a test can prove the path travelled through the URL unmangled. */
    public requestedPath: string | undefined;

    constructor(
        private readonly answer: Room[] | Error,
        private readonly areas: Area[] | Error = [],
    ) {}

    listRooms(): Promise<Room[]> {
        return this.answer instanceof Error ? Promise.reject(this.answer) : Promise.resolve(this.answer);
    }

    listAreas(path: string): Promise<Area[]> {
        this.requestedPath = path;

        return this.areas instanceof Error ? Promise.reject(this.areas) : Promise.resolve(this.areas);
    }
}

/** Builds a personal area owned by `ownerId`, unclaimed when that is null. */
function personalArea(id: string, name: string, ownerId: string | null, allowedTags: string[] = []): Area {
    return {
        id,
        name,
        kinds: ["personalAreaPropertyData"],
        personal: { ownerId, ownerName: null, ownerUnknown: false, allowedTags, accessClaimMode: "dynamic" },
    };
}

const ROOM: Room = {
    path: "maps/areas.wam",
    roomUrl: "/~/maps/areas.wam",
    wamUrl: `${PUBLIC_MAP_STORAGE}/maps/areas.wam`,
    name: "Areas",
    description: undefined,
    thumbnail: undefined,
    copyright: undefined,
    areasSearchable: undefined,
    entitiesSearchable: undefined,
};

describe("GET /admin/api/rooms", () => {
    it("answers the catalogue", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0, rooms: new StubRoomCatalogue([ROOM]) });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await fetch(`${app.url}/admin/api/rooms`, { headers: session.cookieOnlyHeaders });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual([ROOM]);
    });

    it("answers 502 when map-storage is unreachable, and says whose outage it is", async () => {
        const app = await serveDashboardTestApp({
            members: [ADMIN],
            now: T0,
            rooms: new StubRoomCatalogue(new RoomCatalogueUnavailable("map-storage could not be reached.")),
        });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await fetch(`${app.url}/admin/api/rooms`, { headers: session.cookieOnlyHeaders });

        expect(response.status).toBe(502);
        expect(await response.json()).toMatchObject({ code: "ADMIN_ROOMS_UNAVAILABLE" });
    });

    it("answers 501 when this deployment never said where map-storage is", async () => {
        // Distinct from the outage on purpose: telling an operator to restart map-storage when the URL was never set
        // wastes their afternoon.
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0 });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await fetch(`${app.url}/admin/api/rooms`, { headers: session.cookieOnlyHeaders });

        expect(response.status).toBe(501);
        expect(await response.json()).toMatchObject({ code: "ADMIN_ROOMS_NOT_CONFIGURED" });
    });

    it("leaves the rest of the dashboard working when the catalogue is down", async () => {
        // The room list is the one thing here that depends on another service. It must not be able to take the
        // members screen with it.
        const app = await serveDashboardTestApp({
            members: [ADMIN],
            now: T0,
            rooms: new StubRoomCatalogue(new RoomCatalogueUnavailable("down")),
        });
        const session = await signInAs(ADMIN_EMAIL, T0);

        expect((await fetch(`${app.url}/admin/api/members`, { headers: session.cookieOnlyHeaders })).status).toBe(200);
        expect((await fetch(`${app.url}/api/capabilities`)).status).toBe(200);
    });

    it("is refused without a session", async () => {
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0, rooms: new StubRoomCatalogue([ROOM]) });

        expect((await fetch(`${app.url}/admin/api/rooms`, { redirect: "manual" })).status).toBe(401);
    });

    it("carries a nested room path through the URL intact", async () => {
        // `maps/tests/area.wam` is one room, not three path segments. Getting this wrong asks map-storage for a file
        // that does not exist, and the screen would report an outage that is not happening.
        const catalogue = new StubRoomCatalogue([ROOM], []);
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0, rooms: catalogue });
        const session = await signInAs(ADMIN_EMAIL, T0);

        await fetch(`${app.url}/admin/api/rooms/maps/tests/area.wam/areas`, { headers: session.cookieOnlyHeaders });

        expect(catalogue.requestedPath).toBe("maps/tests/area.wam");
    });

    it("is read-only", async () => {
        // Editing a map is the map editor's job. A write here would be a second place that can change a map, with
        // different rules and a different audit story.
        const app = await serveDashboardTestApp({ members: [ADMIN], now: T0, rooms: new StubRoomCatalogue([ROOM]) });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await fetch(`${app.url}/admin/api/rooms`, { method: "POST", headers: session.headers });

        expect(response.status).toBe(404);
    });
});

describe("toAreas", () => {
    /** A map file shaped the way map-storage serves one. */
    const wam = (areas: unknown[]) => ({ version: "1.0.0", mapUrl: "./x.tmj", areas, entities: {} });

    it("reads a personal area's owner, tags and claim mode", () => {
        const areas = toAreas(
            wam([
                {
                    id: "area-1",
                    name: "Pedro's desk",
                    properties: [
                        {
                            type: "personalAreaPropertyData",
                            ownerId: "pedro@empresa.com",
                            allowedTags: ["editor"],
                            accessClaimMode: "dynamic",
                        },
                    ],
                },
            ]),
        );

        expect(areas).toEqual([
            {
                id: "area-1",
                name: "Pedro's desk",
                kinds: ["personalAreaPropertyData"],
                personal: {
                    // The email, which is what the front writes into ownerId (ADR-0002, invariant #2).
                    ownerId: "pedro@empresa.com",
                    ownerName: null,
                    ownerUnknown: false,
                    allowedTags: ["editor"],
                    accessClaimMode: "dynamic",
                },
            },
        ]);
    });

    it("reports an unclaimed personal area as having no owner", () => {
        const areas = toAreas(
            wam([{ id: "a", name: "Free desk", properties: [{ type: "personalAreaPropertyData", ownerId: null }] }]),
        );

        expect(areas[0]?.personal?.ownerId).toBeNull();
        expect(areas[0]?.personal?.allowedTags).toEqual([]);
    });

    it("lists every property an area carries, including ones it does not know", () => {
        // A curated list would silently omit exactly the property somebody is looking for after an upgrade.
        const areas = toAreas(
            wam([
                {
                    id: "a",
                    name: "Meeting room",
                    properties: [{ type: "silent" }, { type: "livekitRoomProperty" }, { type: "somethingNew" }],
                },
            ]),
        );

        expect(areas[0]?.kinds).toEqual(["silent", "livekitRoomProperty", "somethingNew"]);
        expect(areas[0]?.personal).toBeUndefined();
    });

    it("handles a map with no areas", () => {
        expect(toAreas(wam([]))).toEqual([]);
        expect(toAreas({ version: "1.0.0", mapUrl: "./x.tmj" })).toEqual([]);
    });

    it("refuses something that is not a map file", () => {
        expect(() => toAreas({ areas: "not an array" })).toThrow(RoomCatalogueUnavailable);
    });
});

describe("GET /admin/api/rooms/{path}/areas", () => {
    it("puts a name to the owner of a personal area", async () => {
        const app = await serveDashboardTestApp({
            members: [ADMIN, testMember("owner@example.com", ["editor"], "Ana Owner")],
            now: T0,
            rooms: new StubRoomCatalogue([ROOM], [personalArea("a1", "Desk 1", "owner@example.com")]),
        });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await fetch(`${app.url}/admin/api/rooms/maps/areas.wam/areas`, {
            headers: session.cookieOnlyHeaders,
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual([
            {
                id: "a1",
                name: "Desk 1",
                kinds: ["personalAreaPropertyData"],
                personal: {
                    ownerId: "owner@example.com",
                    ownerName: "Ana Owner",
                    ownerUnknown: false,
                    allowedTags: [],
                    accessClaimMode: "dynamic",
                },
            },
        ]);
    });

    it("flags an owner we have no member row for", async () => {
        // Usually an area claimed before the Admin API was switched on. An administrator seeing "unknown" can act on
        // it; one seeing a blank cell cannot.
        const app = await serveDashboardTestApp({
            members: [ADMIN],
            now: T0,
            rooms: new StubRoomCatalogue([ROOM], [personalArea("a1", "Desk", "ghost@example.com")]),
        });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const body = (await (
            await fetch(`${app.url}/admin/api/rooms/maps/areas.wam/areas`, { headers: session.cookieOnlyHeaders })
        ).json()) as { personal: { ownerUnknown: boolean; ownerName: string | null } }[];

        expect(body[0]?.personal.ownerUnknown).toBe(true);
        expect(body[0]?.personal.ownerName).toBeNull();
    });

    it("leaves an unclaimed area alone rather than calling it unknown", async () => {
        const app = await serveDashboardTestApp({
            members: [ADMIN],
            now: T0,
            rooms: new StubRoomCatalogue([ROOM], [personalArea("a1", "Free desk", null)]),
        });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const body = (await (
            await fetch(`${app.url}/admin/api/rooms/maps/areas.wam/areas`, { headers: session.cookieOnlyHeaders })
        ).json()) as { personal: { ownerUnknown: boolean } }[];

        expect(body[0]?.personal.ownerUnknown).toBe(false);
    });

    it("answers 502 when the map cannot be read", async () => {
        const app = await serveDashboardTestApp({
            members: [ADMIN],
            now: T0,
            rooms: new StubRoomCatalogue([ROOM], new RoomCatalogueUnavailable("gone")),
        });
        const session = await signInAs(ADMIN_EMAIL, T0);

        const response = await fetch(`${app.url}/admin/api/rooms/maps/areas.wam/areas`, {
            headers: session.cookieOnlyHeaders,
        });

        expect(response.status).toBe(502);
    });

    it("is refused without a session", async () => {
        const app = await serveDashboardTestApp({
            members: [ADMIN],
            now: T0,
            rooms: new StubRoomCatalogue([ROOM], []),
        });

        const response = await fetch(`${app.url}/admin/api/rooms/maps/areas.wam/areas`, { redirect: "manual" });

        expect(response.status).toBe(401);
    });
});

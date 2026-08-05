import { isFetchMemberDataByUuidResponse } from "@workadventure/messages";
import { afterEach, describe, expect, it } from "vitest";
import { buildApplications } from "../src/Application/ApplicationsCatalogue";
import { canEditMap } from "../src/Application/RoomAccessService";
import {
    closeStartedServers,
    serveTestApp,
    StubBanRepository,
    StubMemberRepository,
    TEST_ADMIN_API_TOKEN,
    TEST_ROOM_ACCESS_CONFIGURATION,
    testMember,
} from "./helpers/testApp";

const BASE = "http://play.workadventure.localhost";
const EDITABLE_ROOM = `${BASE}/~/maps/areas.wam`;
const EXTERNAL_ROOM = `${BASE}/_/global/maps.workadventu.re/starter/map.json`;

const roomAccess = (url: string, params: Record<string, string | string[]>) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        for (const single of Array.isArray(value) ? value : [value]) {
            query.append(key, single);
        }
    }

    return fetch(`${url}/api/room/access?${query.toString()}`, { headers: { Authorization: TEST_ADMIN_API_TOKEN } });
};

/** `Response.json()` is typed `unknown`; these tests assert on shape, so a record view is enough. */
const bodyOf = async (response: Response): Promise<Record<string, unknown>> =>
    (await response.json()) as Record<string, unknown>;

afterEach(closeStartedServers);

describe("GET /api/room/access", () => {
    it("requires the admin token", async () => {
        const url = await serveTestApp();

        const response = await fetch(`${url}/api/room/access?userIdentifier=a@b.c&playUri=${EDITABLE_ROOM}`);

        expect(response.status).toBe(403);
    });

    it("answers 400 when userIdentifier or playUri is missing", async () => {
        const url = await serveTestApp();

        const response = await roomAccess(url, { playUri: EDITABLE_ROOM });

        expect(response.status).toBe(400);
    });

    it("validates against the very zod schema the pusher parses it with", async () => {
        const url = await serveTestApp({
            memberRepository: new StubMemberRepository([testMember("known@example.com", ["admin"])]),
        });

        const response = await roomAccess(url, {
            userIdentifier: "known@example.com",
            playUri: EDITABLE_ROOM,
            characterTextureIds: ["male1"],
        });

        expect(response.status).toBe(200);
        expect(isFetchMemberDataByUuidResponse.safeParse(await response.json())).toMatchObject({ success: true });
    });

    describe("the door (ADR-0006, decision #2)", () => {
        const ban = (identifier: string, message = "You have been banned by an admin") =>
            new StubBanRepository([
                { identifier, displayName: null, message, roomUrl: "/~/maps/office.wam", issuedBy: "boss@example.com" },
            ]);

        it("answers a banned member the error variant of the very union the pusher parses — with HTTP 200", async () => {
            // 200 is the contract, not a nicety: the pusher's axios throws on any non-2xx and substitutes a generic
            // "Connection error", which would cost the banned person the message written for them.
            const url = await serveTestApp({
                memberRepository: new StubMemberRepository([testMember("banned@example.com", ["editor"])]),
                banRepository: ban("banned@example.com"),
            });

            const response = await roomAccess(url, {
                userIdentifier: "banned@example.com",
                playUri: EDITABLE_ROOM,
                characterTextureIds: ["male1"],
            });

            expect(response.status).toBe(200);

            const body = await bodyOf(response);

            expect(isFetchMemberDataByUuidResponse.safeParse(body)).toMatchObject({ success: true });
            expect(body).toMatchObject({
                status: "error",
                type: "error",
                code: "USER_BANNED",
                subtitle: "You have been banned by an admin",
            });
        });

        it("closes the door on a banned anonymous visitor too", async () => {
            // The pusher names an anonymous visitor with a uuid; a ban recorded against it must hold.
            const url = await serveTestApp({ banRepository: ban("998ce839-3dea-4698-8b41-ebbdf7688ad9") });

            const response = await roomAccess(url, {
                userIdentifier: "998ce839-3dea-4698-8b41-ebbdf7688ad9",
                playUri: EDITABLE_ROOM,
                characterTextureIds: ["male1"],
            });

            expect(await bodyOf(response)).toMatchObject({ status: "error", code: "USER_BANNED" });
        });

        it("matches the ban whatever casing the pusher sends the identifier in", async () => {
            const url = await serveTestApp({ banRepository: ban("Banned@Example.COM") });

            const response = await roomAccess(url, {
                userIdentifier: "banned@example.com",
                playUri: EDITABLE_ROOM,
                characterTextureIds: ["male1"],
            });

            expect(await bodyOf(response)).toMatchObject({ status: "error", code: "USER_BANNED" });
        });

        it("falls back to a readable sentence when the ban carries no message", async () => {
            // The pusher may POST a ban with every optional field empty; the door must still say something human.
            const url = await serveTestApp({ banRepository: ban("banned@example.com", "") });

            const response = await roomAccess(url, {
                userIdentifier: "banned@example.com",
                playUri: EDITABLE_ROOM,
                characterTextureIds: ["male1"],
            });

            expect(await bodyOf(response)).toMatchObject({
                status: "error",
                subtitle: "You have been banned from this world.",
            });
        });

        it("leaves invariant #9 intact: an unknown, non-banned visitor still enters", async () => {
            // Banned is a fact we recorded; unknown is the absence of one. The door must not blur that line.
            const url = await serveTestApp({ banRepository: ban("somebody.else@example.com") });

            const response = await roomAccess(url, {
                userIdentifier: "stranger@example.com",
                playUri: EDITABLE_ROOM,
                characterTextureIds: ["male1"],
            });

            expect(response.status).toBe(200);
            expect(await response.json()).toMatchObject({ status: "ok", tags: [], canEdit: false });
        });
    });

    describe("an unknown visitor", () => {
        it("gets in with no tags rather than being rejected", async () => {
            // Rejecting here would mean nobody new could ever enter the world.
            const url = await serveTestApp();

            const response = await roomAccess(url, {
                userIdentifier: "stranger@example.com",
                playUri: EDITABLE_ROOM,
                characterTextureIds: ["male1"],
            });

            expect(response.status).toBe(200);
            expect(await response.json()).toMatchObject({ status: "ok", tags: [], canEdit: false });
        });

        it("still validates against the contract schema", async () => {
            const url = await serveTestApp();

            const response = await roomAccess(url, {
                userIdentifier: "stranger@example.com",
                playUri: EDITABLE_ROOM,
                characterTextureIds: ["male1"],
            });

            expect(isFetchMemberDataByUuidResponse.safeParse(await response.json())).toMatchObject({ success: true });
        });
    });

    describe("tags come from the database", () => {
        it("returns the member's stored tags", async () => {
            const url = await serveTestApp({
                memberRepository: new StubMemberRepository([testMember("boss@example.com", ["admin", "editor"])]),
            });

            const response = await roomAccess(url, {
                userIdentifier: "boss@example.com",
                playUri: EDITABLE_ROOM,
                characterTextureIds: ["male1"],
            });

            expect(((await bodyOf(response)).tags as string[]).sort()).toEqual(["admin", "editor"]);
        });

        it("matches the member regardless of the casing the identity provider sent", async () => {
            const url = await serveTestApp({
                memberRepository: new StubMemberRepository([testMember("boss@example.com", ["admin"])]),
            });

            const response = await roomAccess(url, {
                userIdentifier: "BOSS@Example.COM",
                playUri: EDITABLE_ROOM,
                characterTextureIds: ["male1"],
            });

            expect(await response.json()).toMatchObject({ tags: ["admin"], canEdit: true });
        });
    });

    describe("userUuid", () => {
        it("echoes the identifier the pusher sent, never our internal member id", async () => {
            // The front stores this as its local user uuid and the map editor writes it into
            // personalAreaPropertyData.ownerId. Returning member.id would orphan every claimed personal area (F4).
            const url = await serveTestApp({
                memberRepository: new StubMemberRepository([testMember("boss@example.com", ["admin"])]),
            });

            const response = await roomAccess(url, {
                userIdentifier: "boss@example.com",
                playUri: EDITABLE_ROOM,
                characterTextureIds: ["male1"],
            });

            const body = await bodyOf(response);
            expect(body.userUuid).toBe("boss@example.com");
            expect(body.userUuid).not.toBe("id-boss@example.com");
        });

        it("echoes an anonymous uuid unchanged", async () => {
            const url = await serveTestApp();

            const response = await roomAccess(url, {
                userIdentifier: "998ce839-3dea-4698-8b41-ebbdf7688ad9",
                playUri: EDITABLE_ROOM,
                characterTextureIds: ["male1"],
            });

            expect(await response.json()).toMatchObject({ userUuid: "998ce839-3dea-4698-8b41-ebbdf7688ad9" });
        });
    });

    describe("character textures", () => {
        it("resolves known ids and reports them valid", async () => {
            const url = await serveTestApp();

            const response = await roomAccess(url, {
                userIdentifier: "a@b.c",
                playUri: EDITABLE_ROOM,
                characterTextureIds: ["male1"],
            });

            const body = await bodyOf(response);
            expect(body.isCharacterTexturesValid).toBe(true);
            expect(body.characterTextures).toHaveLength(1);
        });

        it("reports an unknown id invalid, which sends the user to Woka selection", async () => {
            const url = await serveTestApp();

            const response = await roomAccess(url, {
                userIdentifier: "a@b.c",
                playUri: EDITABLE_ROOM,
                characterTextureIds: ["no-such-texture"],
            });

            expect(await response.json()).toMatchObject({ isCharacterTexturesValid: false, characterTextures: [] });
        });

        it("accepts the bracketed array spelling axios produces", async () => {
            // Regression: axios serialises arrays as `characterTextureIds[]=a&characterTextureIds[]=b`, and Express 5's
            // default "simple" parser leaves that as the literal key `characterTextureIds[]`. The ids were dropped,
            // so every user got characterTextures: [] with isCharacterTexturesValid: true — a blank avatar, and no
            // redirect to Woka selection because we had just declared the (empty) selection valid.
            const url = await serveTestApp();

            const response = await fetch(
                `${url}/api/room/access?userIdentifier=a%40b.c&playUri=${encodeURIComponent(EDITABLE_ROOM)}` +
                    `&characterTextureIds%5B%5D=male1&characterTextureIds%5B%5D=body1`,
                { headers: { Authorization: TEST_ADMIN_API_TOKEN } },
            );

            const body = await bodyOf(response);
            expect(body.isCharacterTexturesValid).toBe(true);
            expect(body.characterTextures).toHaveLength(2);
        });

        it("reports invalid when the bracketed ids are unknown, instead of silently returning none", async () => {
            const url = await serveTestApp();

            const response = await fetch(
                `${url}/api/room/access?userIdentifier=a%40b.c&playUri=${encodeURIComponent(EDITABLE_ROOM)}` +
                    `&characterTextureIds%5B%5D=no-such-texture`,
                { headers: { Authorization: TEST_ADMIN_API_TOKEN } },
            );

            expect(await bodyOf(response)).toMatchObject({ isCharacterTexturesValid: false });
        });

        it("accepts a single texture id, which Express parses as a string rather than an array", async () => {
            const url = await serveTestApp();

            const response = await roomAccess(url, {
                userIdentifier: "a@b.c",
                playUri: EDITABLE_ROOM,
                characterTextureIds: "male1",
            });

            expect(await response.json()).toMatchObject({ isCharacterTexturesValid: true });
        });
    });

    describe("companion texture", () => {
        it("reports valid when no companion was requested", async () => {
            const url = await serveTestApp();

            const response = await roomAccess(url, {
                userIdentifier: "a@b.c",
                playUri: EDITABLE_ROOM,
                characterTextureIds: ["male1"],
            });

            expect(await response.json()).toMatchObject({ isCompanionTextureValid: true });
        });

        it("resolves a known companion", async () => {
            const url = await serveTestApp();

            const response = await roomAccess(url, {
                userIdentifier: "a@b.c",
                playUri: EDITABLE_ROOM,
                characterTextureIds: ["male1"],
                companionTextureId: "dog1",
            });

            const body = await bodyOf(response);
            expect(body.isCompanionTextureValid).toBe(true);
            expect(body.companionTexture).toMatchObject({ id: "dog1" });
        });

        it("reports an unknown companion invalid", async () => {
            const url = await serveTestApp();

            const response = await roomAccess(url, {
                userIdentifier: "a@b.c",
                playUri: EDITABLE_ROOM,
                characterTextureIds: ["male1"],
                companionTextureId: "no-such-companion",
            });

            expect(await response.json()).toMatchObject({ isCompanionTextureValid: false });
        });
    });

    describe("canRecord", () => {
        it("is false without an access token even when recording is configured", async () => {
            const url = await serveTestApp({
                roomAccessConfiguration: { ...TEST_ROOM_ACCESS_CONFIGURATION, recordingConfigured: true },
            });

            const response = await roomAccess(url, { userIdentifier: "a@b.c", playUri: EDITABLE_ROOM });

            expect(await response.json()).toMatchObject({ canRecord: false });
        });

        it("is true with an access token when recording is configured", async () => {
            const url = await serveTestApp({
                roomAccessConfiguration: { ...TEST_ROOM_ACCESS_CONFIGURATION, recordingConfigured: true },
            });

            const response = await roomAccess(url, {
                userIdentifier: "a@b.c",
                playUri: EDITABLE_ROOM,
                accessToken: "some-token",
            });

            expect(await response.json()).toMatchObject({ canRecord: true });
        });
    });
});

describe("canEditMap", () => {
    it("is true for a map-storage room when the member holds admin", () => {
        expect(canEditMap(EDITABLE_ROOM, ["admin"], true)).toBe(true);
    });

    it("is true for a map-storage room when the member holds editor", () => {
        expect(canEditMap(EDITABLE_ROOM, ["editor"], true)).toBe(true);
    });

    it("is false without one of those tags", () => {
        expect(canEditMap(EDITABLE_ROOM, [], true)).toBe(false);
        expect(canEditMap(EDITABLE_ROOM, ["someone-else"], true)).toBe(false);
    });

    it("is false outside map-storage rooms, which are the only editable ones", () => {
        expect(canEditMap(EXTERNAL_ROOM, ["admin"], true)).toBe(false);
    });

    it("is false when the map editor is disabled globally, whatever the tags say", () => {
        expect(canEditMap(EDITABLE_ROOM, ["admin"], false)).toBe(false);
    });

    it("is false for an unparseable playUri rather than throwing", () => {
        expect(canEditMap("not-a-url", ["admin"], true)).toBe(false);
    });

    it("ignores MAP_EDITOR_ALLOW_ALL_USERS by design: authorisation is the database's job now", () => {
        // LocalAdmin also grants canEdit through MAP_EDITOR_ALLOW_ALL_USERS and MAP_EDITOR_ALLOWED_USERS. Honouring
        // them here would defeat the feature: the pusher stops forwarding OIDC tags once ADMIN_API_URL is set, so a
        // permission has to be grantable through a screen, not an environment variable.
        expect(canEditMap(EDITABLE_ROOM, [], true)).toBe(false);
    });
});

describe("buildApplications", () => {
    const allOff = {
        klaxoon: false,
        youtube: false,
        googleDrive: false,
        googleDocs: false,
        googleSheets: false,
        googleSlides: false,
        eraser: false,
        excalidraw: false,
        cards: false,
        tldraw: false,
    };

    it("returns nothing when every integration is disabled", () => {
        expect(buildApplications(allOff)).toEqual([]);
    });

    it("omits disabled integrations entirely rather than listing them as disabled", () => {
        const applications = buildApplications({ ...allOff, klaxoon: true });

        expect(applications).toHaveLength(1);
        expect(applications[0]).toMatchObject({ name: "Klaxoon", enabled: true, default: true });
    });

    it("keeps LocalAdmin's order, because the front renders these as a list", () => {
        const applications = buildApplications({ ...allOff, tldraw: true, klaxoon: true, youtube: true });

        expect(applications.map((application) => application.name)).toEqual(["Klaxoon", "Youtube", "tldraw"]);
    });
});

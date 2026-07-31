import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";
import { closeStartedServers, serveTestApp, StubTagRepository, TEST_ADMIN_API_TOKEN } from "./helpers/testApp";

const auth = { headers: { Authorization: TEST_ADMIN_API_TOKEN } };

/** The very shape `AdminApi.getTagsList` parses. `searchTags` does not parse at all, so we hold both to it. */
const TagList = z.string().array();

const withTags = (...names: string[]) => new StubTagRepository(names);

afterEach(closeStartedServers);

describe("GET /api/world/tags", () => {
    it("requires the admin token", async () => {
        const url = await serveTestApp();

        const response = await fetch(`${url}/api/world/tags?searchText=ad`);

        expect(response.status).toBe(403);
    });

    it("answers a plain array of strings", async () => {
        const url = await serveTestApp({ tagRepository: withTags("admin", "editor") });

        const response = await fetch(`${url}/api/world/tags?searchText=ad`, auth);

        expect(response.status).toBe(200);
        expect(TagList.safeParse(await response.json())).toMatchObject({ success: true });
    });

    it("filters by the typed text, case-insensitively", async () => {
        const url = await serveTestApp({ tagRepository: withTags("admin", "editor") });

        const response = await fetch(`${url}/api/world/tags?searchText=EDIT`, auth);

        expect(await response.json()).toEqual(["editor"]);
    });

    it("returns every tag when the search is empty, unlike member search", async () => {
        // The tag catalogue is small and curated, and these pickers open with a list of options rather than waiting
        // for the user to type. Members are the opposite: unbounded population, so an empty search returns nothing.
        const url = await serveTestApp({ tagRepository: withTags("admin", "editor") });

        const response = await fetch(`${url}/api/world/tags`, auth);

        expect(await response.json()).toEqual(["admin", "editor"]);
    });

    it("answers an empty array, not an error, when nothing matches", async () => {
        const url = await serveTestApp({ tagRepository: withTags("admin") });

        const response = await fetch(`${url}/api/world/tags?searchText=nope`, auth);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual([]);
    });

    it("answers an empty array when no tag exists at all", async () => {
        // handleSearchTagsQuery does not catch, so anything but a well-formed array surfaces as an unhandled error
        // inside the map editor.
        const url = await serveTestApp();

        const response = await fetch(`${url}/api/world/tags?searchText=a`, auth);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual([]);
    });
});

describe("GET /api/room/tags", () => {
    it("requires the admin token", async () => {
        const url = await serveTestApp();

        const response = await fetch(`${url}/api/room/tags?roomUrl=x`);

        expect(response.status).toBe(403);
    });

    it("answers a plain array of strings", async () => {
        const url = await serveTestApp({ tagRepository: withTags("admin", "editor") });

        const response = await fetch(`${url}/api/room/tags?roomUrl=x`, auth);

        expect(response.status).toBe(200);
        expect(TagList.safeParse(await response.json())).toMatchObject({ success: true });
    });

    it("lists every tag, since a single world means every tag is in scope", async () => {
        const url = await serveTestApp({ tagRepository: withTags("editor", "admin") });

        const response = await fetch(`${url}/api/room/tags?roomUrl=x`, auth);

        expect(await response.json()).toEqual(["admin", "editor"]);
    });

    it("answers an empty array rather than failing when no tag exists", async () => {
        // handleRoomTagsQuery swallows failures into an empty list, so a broken response here would be invisible.
        // Answering [] deliberately means the empty list carries information.
        const url = await serveTestApp();

        const response = await fetch(`${url}/api/room/tags?roomUrl=x`, auth);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual([]);
    });
});

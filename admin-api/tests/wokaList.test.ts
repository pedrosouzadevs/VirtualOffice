import { wokaList, wokaPartNames } from "@workadventure/messages";
import { afterEach, describe, expect, it } from "vitest";
import { WokaCatalogue } from "../src/Application/WokaCatalogue";
import { SUPPORTED_CAPABILITIES } from "../src/Capabilities";
import { closeStartedServers, serveTestApp, TEST_ADMIN_API_TOKEN } from "./helpers/testApp";

afterEach(closeStartedServers);

describe("GET /api/woka/list", () => {
    it("requires the admin token", async () => {
        const url = await serveTestApp();

        const response = await fetch(`${url}/api/woka/list`);

        expect(response.status).toBe(403);
    });

    it("validates against the very zod schema the pusher parses it with", async () => {
        const url = await serveTestApp();

        const response = await fetch(`${url}/api/woka/list?roomUrl=whatever&uuid=whoever`, {
            headers: { Authorization: TEST_ADMIN_API_TOKEN },
        });

        expect(response.status).toBe(200);
        expect(wokaList.safeParse(await response.json())).toMatchObject({ success: true });
    });

    it("is declared as a capability, since the endpoint now exists", () => {
        expect(SUPPORTED_CAPABILITIES).toMatchObject({ "api/woka/list": "v1" });
    });
});

describe("WokaCatalogue", () => {
    const catalogue = new WokaCatalogue();

    it("carries every Woka part the pusher iterates over", async () => {
        const list = await catalogue.getWokaList();

        for (const partName of wokaPartNames) {
            expect(Object.keys(list)).toContain(partName);
        }
    });

    it("resolves a known texture id to its details", async () => {
        const resolved = await catalogue.resolveTextures(["male1"]);

        expect(resolved).toHaveLength(1);
        expect(resolved?.[0]).toMatchObject({ id: "male1" });
    });

    it("returns undefined when any id is unknown, which is what bounces the user to Woka selection", async () => {
        expect(await catalogue.resolveTextures(["male1", "does-not-exist"])).toBeUndefined();
        expect(await catalogue.resolveTextures(["does-not-exist"])).toBeUndefined();
    });

    it("resolves an empty list to an empty result rather than undefined", async () => {
        expect(await catalogue.resolveTextures([])).toEqual([]);
    });

    it("preserves the caller's order, because the front layers the textures in sequence", async () => {
        const list = await catalogue.getWokaList();
        const bodyId = list.body?.collections[0]?.textures[0]?.id;
        expect(bodyId).toBeDefined();

        const resolved = await catalogue.resolveTextures(["male1", bodyId as string]);

        expect(resolved?.map((texture) => texture.id)).toEqual(["male1", bodyId]);
    });

    it("serves the same catalogue it validates against, so the list and the check cannot disagree", async () => {
        // ADR-0002 Trap #3: divergence between these two shows up as a login loop, not an error.
        const list = await catalogue.getWokaList();
        const firstWoka = list.woka?.collections[0]?.textures[0];
        expect(firstWoka).toBeDefined();

        const resolved = await catalogue.resolveTextures([firstWoka!.id]);

        expect(resolved?.[0]).toEqual(firstWoka);
    });
});

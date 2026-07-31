import { readFile } from "node:fs/promises";
import { wokaList, wokaPartNames, type WokaDetail, type WokaList } from "@workadventure/messages";

/**
 * The world's Woka (avatar) catalogue.
 *
 * ⚠️ `src/data/woka.json` is a copy of `play/src/pusher/data/woka.json`. It has to live here because in production
 * `admin-api` is its own image and cannot read `play`'s files — but it does mean the copy must be refreshed whenever
 * upstream changes theirs.
 *
 * Serving `/api/woka/list` and resolving `characterTextureIds` from **the same** file is the point (ADR-0002,
 * Trap #3): if the list the user picks from disagrees with the one we validate against, the user is bounced to the
 * Woka selection page, picks a texture we reject, and is bounced again — a login loop.
 */
export class WokaCatalogue {
    private catalogue: Promise<WokaList> | undefined;

    constructor(private readonly catalogueUrl: URL = new URL("../data/woka.json", import.meta.url)) {}

    /**
     * Loads and validates the catalogue once, then serves it from memory.
     *
     * Parsing through `wokaList` — the pusher's own schema — means a malformed copy fails here at first use rather
     * than reaching `play` as an unreadable payload.
     */
    private load(): Promise<WokaList> {
        if (this.catalogue === undefined) {
            this.catalogue = readFile(this.catalogueUrl, "utf8").then((content) => wokaList.parse(JSON.parse(content)));
        }

        return this.catalogue;
    }

    /** Full catalogue, as served by `GET /api/woka/list`. */
    getWokaList(): Promise<WokaList> {
        return this.load();
    }

    /**
     * Resolves texture ids into the details `/api/room/access` must return.
     *
     * ⚠️ **Order is the rendering order, not the request order.** The front layers these sprites in array order
     * (`CharacterLayerManager.wokaBase64` → `getSprites`), so the result must follow `wokaPartNames` — body, then
     * eyes, then hair, and so on. Returning the caller's order paints hair underneath the body and the avatar comes
     * out wrong. `LocalWokaService.fetchWokaDetails` gets this right by accident, because it collects into a Map
     * while walking the catalogue; we do the same deliberately.
     *
     * @returns `undefined` when **any** id is unknown, which is the signal to send the user to the Woka selection
     * page. Partial resolution is deliberately not an option: it would let a user keep an avatar we cannot render.
     */
    async resolveTextures(textureIds: readonly string[]): Promise<WokaDetail[] | undefined> {
        const catalogue = await this.load();
        const resolved = new Map<string, WokaDetail>();

        // Walking parts in wokaPartNames order is what puts the result in layering order: Map preserves insertion.
        for (const partName of wokaPartNames) {
            const part = catalogue[partName];
            if (!part) {
                continue;
            }

            for (const collection of part.collections) {
                for (const texture of collection.textures) {
                    if (textureIds.includes(texture.id) && !resolved.has(texture.id)) {
                        // Narrowed to the two fields WokaDetail carries, exactly like LocalWokaService.
                        resolved.set(texture.id, { id: texture.id, url: texture.url });
                    }
                }
            }
        }

        if (resolved.size !== new Set(textureIds).size) {
            return undefined;
        }

        return [...resolved.values()];
    }
}

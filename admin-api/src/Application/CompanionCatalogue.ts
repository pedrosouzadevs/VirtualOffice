import { readFile } from "node:fs/promises";
import { CompanionTextureCollection, type CompanionDetail } from "@workadventure/messages";

/**
 * The world's companion (pet) catalogue.
 *
 * ⚠️ `src/data/companions.json` is a copy of `play/src/pusher/data/companions.json`, for the same reason as the Woka
 * catalogue: in production `admin-api` is its own image and cannot read `play`'s files. The copy has to be refreshed
 * whenever upstream changes theirs.
 *
 * Serving `/api/companion/list` from the same file we resolve `companionTextureId` against is what stops the list a
 * user picks from disagreeing with the one we accept — the milder sibling of ADR-0002's Trap #3: instead of a login
 * loop, the user is bounced back to companion selection every time.
 */
export class CompanionCatalogue {
    private catalogue: Promise<CompanionTextureCollection[]> | undefined;

    constructor(private readonly catalogueUrl: URL = new URL("../data/companions.json", import.meta.url)) {}

    private load(): Promise<CompanionTextureCollection[]> {
        if (this.catalogue === undefined) {
            this.catalogue = readFile(this.catalogueUrl, "utf8").then((content) =>
                CompanionTextureCollection.array().parse(JSON.parse(content)),
            );
        }

        return this.catalogue;
    }

    /** Full catalogue, as served by `GET /api/companion/list`. */
    getCompanionList(): Promise<CompanionTextureCollection[]> {
        return this.load();
    }

    /**
     * Resolves a companion texture id into the detail `/api/room/access` must return.
     *
     * @returns `undefined` when the id is unknown, which is the signal to send the user to companion selection.
     */
    async resolveTexture(textureId: string): Promise<CompanionDetail | undefined> {
        const collections = await this.load();

        for (const collection of collections) {
            const texture = collection.textures.find((candidate) => candidate.id === textureId);

            if (texture) {
                return { id: texture.id, url: texture.url };
            }
        }

        return undefined;
    }
}

import { describe, expect, it } from "vitest";
import { TILE_EDITOR_TAGS, canEditTiles } from "../src/Utils";

/**
 * Tests for the structural (tile) editing gate (ADR-0007). The predicate is the single source of truth shared
 * by the front, the pusher and map-storage; these tests pin the product decision that is easiest to "fix" by
 * accident: only adminMap counts — admin and editor get NO override.
 */
describe("canEditTiles", () => {
    it("allows the adminMap tag", () => {
        expect(canEditTiles(["adminMap"])).toBe(true);
    });

    it("allows adminMap among other tags", () => {
        expect(canEditTiles(["member", "adminMap", "editor"])).toBe(true);
    });

    it("denies the empty tag list", () => {
        expect(canEditTiles([])).toBe(false);
    });

    it("denies admin and editor: structural editing has no override, by product decision", () => {
        expect(canEditTiles(["admin"])).toBe(false);
        expect(canEditTiles(["editor"])).toBe(false);
        expect(canEditTiles(["admin", "editor"])).toBe(false);
    });

    it("is case-sensitive, like every other tag comparison", () => {
        expect(canEditTiles(["adminmap"])).toBe(false);
        expect(canEditTiles(["AdminMap"])).toBe(false);
    });

    it("keeps TILE_EDITOR_TAGS at exactly adminMap until an ADR says otherwise", () => {
        expect(TILE_EDITOR_TAGS).toEqual(["adminMap"]);
    });
});

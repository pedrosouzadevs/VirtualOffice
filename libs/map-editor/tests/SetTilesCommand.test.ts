import { describe, expect, it } from "vitest";
import { ClearTileOverlayCommand } from "../src/Commands/Tiles/ClearTileOverlayCommand";
import { SetTilesCommand } from "../src/Commands/Tiles/SetTilesCommand";
import { WamFile } from "../src/GameMap/WamFile";
import { WAMFileFormat } from "../src/types";

/**
 * Tests for the WAM tile overlay written by structural edits (ADR-0007). Two guarantees matter most here:
 * last-write-wins per cell (the overlay is O(cells touched), not O(edits made)), and surviving a
 * WAMFileFormat.parse round-trip — map-storage re-validates the WAM after every command and the autosave
 * serializes it, so a zod schema that stripped the overlay would silently destroy every edit.
 */

function freshWam(): WAMFileFormat {
    return {
        version: "2.0.0",
        mapUrl: "office.tmj",
        entities: {},
        areas: [],
        entityCollections: [],
    };
}

describe("SetTilesCommand", () => {
    it("creates the overlay containers on first use", async () => {
        const wamFile = new WamFile(freshWam());

        await new SetTilesCommand(wamFile, [{ x: 3, y: 4, layerName: "walls1", gid: 42 }]).execute();

        expect(wamFile.getWam().tileOverlay).toEqual({ layers: { walls1: { "3,4": 42 } } });
    });

    it("keeps the last write per cell, so repainting does not grow the overlay", async () => {
        const wamFile = new WamFile(freshWam());

        await new SetTilesCommand(wamFile, [{ x: 1, y: 1, layerName: "floor1", gid: 7 }]).execute();
        await new SetTilesCommand(wamFile, [{ x: 1, y: 1, layerName: "floor1", gid: 9 }]).execute();

        expect(wamFile.getWam().tileOverlay).toEqual({ layers: { floor1: { "1,1": 9 } } });
    });

    it("stores gid 0 as an explicit erase entry, distinct from an absent key", async () => {
        const wamFile = new WamFile(freshWam());

        await new SetTilesCommand(wamFile, [{ x: 5, y: 6, layerName: "walls1", gid: 0 }]).execute();

        expect(wamFile.getWam().tileOverlay?.layers["walls1"]?.["5,6"]).toBe(0);
    });

    it("applies a whole stroke across layers in one command", async () => {
        const wamFile = new WamFile(freshWam());

        await new SetTilesCommand(wamFile, [
            { x: 0, y: 0, layerName: "walls1", gid: 11 },
            { x: 0, y: 0, layerName: "collisions", gid: 3 },
            { x: 1, y: 0, layerName: "walls1", gid: 11 },
        ]).execute();

        expect(wamFile.getWam().tileOverlay).toEqual({
            layers: { walls1: { "0,0": 11, "1,0": 11 }, collisions: { "0,0": 3 } },
        });
    });

    it("is idempotent on replay, which is what makes the join-time catch-up safe", async () => {
        const wamFile = new WamFile(freshWam());
        const command = new SetTilesCommand(wamFile, [{ x: 2, y: 2, layerName: "floor1", gid: 5 }], "cmd-1");

        await command.execute();
        const afterFirst = structuredClone(wamFile.getWam().tileOverlay);
        await command.execute();

        expect(wamFile.getWam().tileOverlay).toEqual(afterFirst);
    });

    it("does not keep a live reference to the caller's array", async () => {
        const wamFile = new WamFile(freshWam());
        const tiles = [{ x: 1, y: 2, layerName: "floor1", gid: 8 }];
        const command = new SetTilesCommand(wamFile, tiles);
        tiles[0].gid = 999;

        await command.execute();

        expect(wamFile.getWam().tileOverlay?.layers["floor1"]?.["1,2"]).toBe(8);
    });

    it("survives a WAMFileFormat.parse round-trip: the schema must not strip the overlay", async () => {
        const wamFile = new WamFile(freshWam());
        await new SetTilesCommand(wamFile, [
            { x: 3, y: 4, layerName: "walls1", gid: 42 },
            { x: 5, y: 6, layerName: "walls1", gid: 0 },
        ]).execute();

        const reparsed = WAMFileFormat.parse(JSON.parse(JSON.stringify(wamFile.getWam())));

        expect(reparsed.tileOverlay).toEqual({ layers: { walls1: { "3,4": 42, "5,6": 0 } } });
    });

    it("preserves flip-flag gids verbatim up to the uint32 ceiling", async () => {
        const flippedGid = 0x80000000 + 42; // horizontal-flip flag set
        const wamFile = new WamFile(freshWam());

        await new SetTilesCommand(wamFile, [{ x: 7, y: 8, layerName: "furniture1", gid: flippedGid }]).execute();
        const reparsed = WAMFileFormat.parse(JSON.parse(JSON.stringify(wamFile.getWam())));

        expect(reparsed.tileOverlay?.layers["furniture1"]?.["7,8"]).toBe(flippedGid);
    });

    it("rejects a malformed cell key on re-validation, so corrupted overlays cannot be persisted", async () => {
        const wamFile = new WamFile(freshWam());
        await new SetTilesCommand(wamFile, [{ x: 1, y: 1, layerName: "floor1", gid: 1 }]).execute();
        const wam = JSON.parse(JSON.stringify(wamFile.getWam())) as WAMFileFormat;
        // Simulate corruption: a key that is not "x,y".
        wam.tileOverlay!.layers["floor1"]!["not-a-coordinate"] = 1;

        expect(WAMFileFormat.safeParse(wam).success).toBe(false);
    });
});

describe("ClearTileOverlayCommand", () => {
    it("removes the whole overlay", async () => {
        const wamFile = new WamFile(freshWam());
        await new SetTilesCommand(wamFile, [{ x: 1, y: 1, layerName: "floor1", gid: 7 }]).execute();

        await new ClearTileOverlayCommand(wamFile).execute();

        expect(wamFile.getWam().tileOverlay).toBeUndefined();
        expect("tileOverlay" in wamFile.getWam()).toBe(false);
    });

    it("is a no-op on a WAM that never had an overlay", async () => {
        const wamFile = new WamFile(freshWam());

        await new ClearTileOverlayCommand(wamFile).execute();

        expect(wamFile.getWam().tileOverlay).toBeUndefined();
    });
});

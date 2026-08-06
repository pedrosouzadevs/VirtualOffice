import { describe, expect, it } from "vitest";
import { WamFile } from "@workadventure/map-editor";
import type { TileChange, WAMFileFormat } from "@workadventure/map-editor";
import { SetTilesFrontCommand } from "../../../src/front/Phaser/Game/MapEditor/Commands/Tiles/SetTilesFrontCommand";
import type { GameMapFrontWrapper } from "../../../src/front/Phaser/Game/GameMap/GameMapFrontWrapper";

/**
 * Undo-symmetry tests for the structural-edit front command (ADR-0007). The undo path is what
 * revertPendingCommands leans on when a foreign command arrives — a wrong "previous" capture would corrupt
 * every concurrent editing session, so this is pinned without Phaser via a minimal wrapper double.
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

function stubWrapper(initialGids: Record<string, number>) {
    // Doubles the two members SetTilesFrontCommand touches. The fake flat-layer state lets the undo capture
    // read real "previous" values and lets the assertions see what got painted.
    const cells = new Map(Object.entries(initialGids));
    const strokes: TileChange[][] = [];
    const wrapper = {
        getRawTileGidAt: (x: number, y: number, layerName: string): number | undefined =>
            cells.get(`${layerName}:${x},${y}`),
        setTilesBatch: (tiles: TileChange[]): void => {
            strokes.push(structuredClone(tiles));
            for (const tile of tiles) {
                cells.set(`${tile.layerName}:${tile.x},${tile.y}`, tile.gid);
            }
        },
    };
    return { wrapper: wrapper as unknown as GameMapFrontWrapper, cells, strokes };
}

describe("SetTilesFrontCommand", () => {
    it("writes the overlay and paints the stroke", async () => {
        const wamFile = new WamFile(freshWam());
        const { wrapper, cells, strokes } = stubWrapper({ "walls1:1,2": 7 });

        await new SetTilesFrontCommand(
            wamFile,
            [{ x: 1, y: 2, layerName: "walls1", gid: 42 }],
            "cmd-1",
            wrapper,
        ).execute();

        expect(wamFile.getWam().tileOverlay).toEqual({ layers: { walls1: { "1,2": 42 } } });
        expect(cells.get("walls1:1,2")).toBe(42);
        expect(strokes).toHaveLength(1);
    });

    it("execute followed by undo restores every painted cell to its previous gid", async () => {
        const wamFile = new WamFile(freshWam());
        const { wrapper, cells } = stubWrapper({ "walls1:1,2": 7, "collisions:1,2": 0 });

        const command = new SetTilesFrontCommand(
            wamFile,
            [
                { x: 1, y: 2, layerName: "walls1", gid: 42 },
                { x: 1, y: 2, layerName: "collisions", gid: 3 },
                { x: 9, y: 9, layerName: "walls1", gid: 42 },
            ],
            "cmd-1",
            wrapper,
        );

        await command.execute();
        await command.getUndoCommand().execute();

        expect(cells.get("walls1:1,2")).toBe(7);
        expect(cells.get("collisions:1,2")).toBe(0);
        // A cell the stub never held reads as gid 0 after undo: erased, matching an empty base map.
        expect(cells.get("walls1:9,9")).toBe(0);
    });

    it("undo of the undo re-applies the stroke (redo)", async () => {
        const wamFile = new WamFile(freshWam());
        const { wrapper, cells } = stubWrapper({ "floor1:4,4": 11 });

        const command = new SetTilesFrontCommand(
            wamFile,
            [{ x: 4, y: 4, layerName: "floor1", gid: 25 }],
            "cmd-1",
            wrapper,
        );

        await command.execute();
        const undo = command.getUndoCommand();
        await undo.execute();
        await undo.getUndoCommand().execute();

        expect(cells.get("floor1:4,4")).toBe(25);
        expect(wamFile.getWam().tileOverlay?.layers["floor1"]?.["4,4"]).toBe(25);
    });

    it("captures previous gids at construction time, before anything is painted", () => {
        const wamFile = new WamFile(freshWam());
        const { wrapper, cells } = stubWrapper({ "walls1:1,2": 7 });

        const command = new SetTilesFrontCommand(
            wamFile,
            [{ x: 1, y: 2, layerName: "walls1", gid: 42 }],
            "cmd-1",
            wrapper,
        );
        // Something else paints the cell between construction and undo — the undo must still restore the
        // value captured at construction, which is what revertPendingCommands' LIFO ordering guarantees
        // system-wide.
        cells.set("walls1:1,2", 99);

        const undo = command.getUndoCommand();
        expect(undo["tiles"]).toEqual([{ x: 1, y: 2, layerName: "walls1", gid: 7 }]);
    });
});

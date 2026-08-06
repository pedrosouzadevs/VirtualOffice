import { describe, expect, it } from "vitest";
import type { ITiledMap } from "@workadventure/tiled-map-type-guard";
import { applyTileOverlayToTmj } from "../src/GameMap/TileOverlayMerge";
import type { TileOverlay } from "../src/types";

/**
 * Consolidation correctness (ADR-0007): the exported .tmj must carry every overlay cell verbatim — flip
 * flags included, gid 0 as a real erase — while leaving everything else in the map untouched, so the
 * output still passes the upload path's MapValidator.
 */

function testMap(): ITiledMap {
    return {
        type: "map",
        version: "1.10",
        orientation: "orthogonal",
        renderorder: "right-down",
        width: 4,
        height: 3,
        tilewidth: 32,
        tileheight: 32,
        infinite: false,
        layers: [
            {
                id: 1,
                name: "floor1",
                type: "tilelayer",
                width: 4,
                height: 3,
                x: 0,
                y: 0,
                visible: true,
                opacity: 1,
                data: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
            },
            {
                id: 2,
                name: "group",
                type: "group",
                x: 0,
                y: 0,
                visible: true,
                opacity: 1,
                layers: [
                    {
                        id: 3,
                        name: "walls1",
                        type: "tilelayer",
                        width: 4,
                        height: 3,
                        x: 0,
                        y: 0,
                        visible: true,
                        opacity: 1,
                        data: [0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0],
                    },
                ],
            },
        ],
        tilesets: [],
    } as unknown as ITiledMap;
}

describe("applyTileOverlayToTmj", () => {
    it("writes overlay gids into flat layer data, reaching layers nested in groups by their flattened name", () => {
        // Overlay keys are the FLATTENED layer names ("group/walls1"): that is what GameMap.flatLayers
        // exposes at runtime, what the editor paints against, and what WA.room.setTiles uses too.
        const map = testMap();
        const overlay: TileOverlay = {
            layers: {
                floor1: { "2,1": 7 },
                "group/walls1": { "0,0": 9 },
            },
        };

        const result = applyTileOverlayToTmj(map, overlay);

        expect(result).toEqual({ applied: 2, skipped: 0 });
        const floor = map.layers[0] as { data: number[] };
        expect(floor.data[2 + 1 * 4]).toBe(7);
        // The flattener shallow-copies layers, so writes through it land in the original nested array.
        const walls = (map.layers[1] as { layers: { data: number[] }[] }).layers[0];
        expect(walls.data[0]).toBe(9);
    });

    it("writes gid 0 as a real erase and keeps flip-flag gids verbatim", () => {
        const map = testMap();
        const flipped = 0x80000000 + 5;
        const overlay: TileOverlay = {
            layers: {
                floor1: { "0,0": 0, "1,0": flipped },
            },
        };

        applyTileOverlayToTmj(map, overlay);

        const floor = map.layers[0] as { data: number[] };
        expect(floor.data[0]).toBe(0);
        expect(floor.data[1]).toBe(flipped);
    });

    it("skips unknown layers and out-of-bounds cells instead of corrupting data", () => {
        const map = testMap();
        const overlay: TileOverlay = {
            layers: {
                ghost: { "0,0": 1 },
                floor1: { "4,0": 1, "0,3": 1, "-1,0": 1, "3,2": 8 },
            },
        };

        const result = applyTileOverlayToTmj(map, overlay);

        expect(result).toEqual({ applied: 1, skipped: 4 });
        const floor = map.layers[0] as { data: number[] };
        expect(floor.data[3 + 2 * 4]).toBe(8);
        expect(floor.data.filter((gid) => gid === 1)).toHaveLength(11);
    });

    it("returns zeros for an absent overlay and leaves the map alone", () => {
        const map = testMap();
        const before = JSON.stringify(map);

        const result = applyTileOverlayToTmj(map, undefined);

        expect(result).toEqual({ applied: 0, skipped: 0 });
        expect(JSON.stringify(map)).toBe(before);
    });

    it("touches nothing but layer data — tilesets, properties and geometry stay byte-identical", () => {
        const map = testMap();
        const overlay: TileOverlay = { layers: { floor1: { "0,0": 3 } } };
        const before = JSON.parse(JSON.stringify(map)) as ITiledMap;

        applyTileOverlayToTmj(map, overlay);

        (before.layers[0] as { data: number[] }).data[0] = 3;
        expect(map).toEqual(before);
    });
});

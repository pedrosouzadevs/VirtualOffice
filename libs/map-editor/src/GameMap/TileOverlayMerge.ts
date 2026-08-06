import type { ITiledMap } from "@workadventure/tiled-map-type-guard";
import type { TileOverlay } from "../types";
import { flattenGroupLayersMap } from "./LayersFlattener";

export interface TileOverlayMergeResult {
    /** Cells written into layer data. */
    applied: number;
    /** Cells dropped: unknown layer, encoded (string) layer data, or out-of-bounds coordinates. */
    skipped: number;
}

/**
 * Bakes a WAM tile overlay (in-game structural edits, ADR-0007) into a .tmj's layer data. This is the
 * consolidation step behind the exported "-consolidated.tmj": the result opens in Tiled desktop and, once
 * re-uploaded and the overlay cleared, becomes the new base map.
 *
 * MUTATES the given map — pass a clone. Gids are written verbatim (flip flags included, 0 erases), and
 * nothing else in the map is touched, so the output passes the same MapValidator the upload path runs.
 *
 * Overlay keys are FLATTENED layer names ("group/child"), matching GameMap.flatLayers at runtime. The
 * flattener shallow-copies each layer, so writing through its `data` reference lands in the original
 * (possibly group-nested) array — which is exactly the point.
 */
export function applyTileOverlayToTmj(map: ITiledMap, overlay: TileOverlay | undefined): TileOverlayMergeResult {
    const result: TileOverlayMergeResult = { applied: 0, skipped: 0 };
    if (!overlay) {
        return result;
    }

    const flatLayers = flattenGroupLayersMap(map);

    for (const [layerName, cells] of Object.entries(overlay.layers)) {
        const layer = flatLayers.find(
            (candidate) => candidate.type === "tilelayer" && candidate.name === layerName,
        );
        if (layer === undefined || layer.type !== "tilelayer" || !Array.isArray(layer.data)) {
            result.skipped += Object.keys(cells).length;
            continue;
        }
        for (const [key, gid] of Object.entries(cells)) {
            const [x, y] = key.split(",").map(Number);
            if (Number.isNaN(x) || Number.isNaN(y) || x < 0 || y < 0 || x >= layer.width || y >= layer.height) {
                result.skipped += 1;
                continue;
            }
            layer.data[x + y * layer.width] = gid;
            result.applied += 1;
        }
    }

    return result;
}

import type { WamFile } from "../../GameMap/WamFile";
import { Command } from "../Command";

/**
 * One cell of a structural edit. Structurally identical to the proto's TileChangeMessage on purpose, so
 * proto payloads can be passed straight in without a mapping layer.
 */
export interface TileChange {
    /** Tile-space X. */
    x: number;
    /** Tile-space Y. */
    y: number;
    /** Name of a FLAT tile layer of the base .tmj. */
    layerName: string;
    /** Raw Tiled gid, flip flags included. 0 erases the cell (an explicit override, not "no entry"). */
    gid: number;
}

/**
 * Writes a brush stroke into the WAM tile overlay (ADR-0007). The base .tmj is never touched; the overlay
 * dict gives last-write-wins semantics per cell, so replaying the same command is a no-op by construction —
 * which is what makes the join-time catch-up replay safe.
 */
export class SetTilesCommand extends Command {
    protected wamFile: WamFile;
    protected tiles: TileChange[];

    constructor(wamFile: WamFile, tiles: TileChange[], commandId?: string) {
        super(commandId);
        this.wamFile = wamFile;
        this.tiles = structuredClone(tiles);
    }

    public execute(): Promise<void> {
        const wam = this.wamFile.getWam();
        const overlay = (wam.tileOverlay ??= { layers: {} });
        for (const tile of this.tiles) {
            const layer = (overlay.layers[tile.layerName] ??= {});
            layer[`${tile.x},${tile.y}`] = tile.gid;
        }
        return Promise.resolve();
    }
}

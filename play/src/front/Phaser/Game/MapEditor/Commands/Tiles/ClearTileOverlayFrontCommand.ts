import { ClearTileOverlayCommand } from "@workadventure/map-editor";
import type { TileChange, TileOverlay, WamFile } from "@workadventure/map-editor";
import type { RoomConnection } from "../../../../../Connection/RoomConnection";
import type { GameMapFrontWrapper } from "../../../GameMap/GameMapFrontWrapper";
import type { FrontCommandInterface } from "../FrontCommandInterface";
import { SetTilesFrontCommand } from "./SetTilesFrontCommand";

export class ClearTileOverlayFrontCommand extends ClearTileOverlayCommand implements FrontCommandInterface {
    private readonly previousOverlay: TileOverlay | undefined;

    constructor(
        wamFile: WamFile,
        commandId: string | undefined,
        private gameMapFrontWrapper: GameMapFrontWrapper,
    ) {
        super(wamFile, commandId);
        this.previousOverlay = structuredClone(wamFile.getWam().tileOverlay);
    }

    public async execute(): Promise<void> {
        await super.execute();
        // Without this, clearing the overlay would only become visible after a reload.
        this.gameMapFrontWrapper.restoreBaseTiles();
    }

    public getUndoCommand(): SetTilesFrontCommand {
        // Repainting the dropped overlay as one big stroke recreates the same dict, cell by cell.
        const tiles: TileChange[] = [];
        if (this.previousOverlay) {
            for (const [layerName, cells] of Object.entries(this.previousOverlay.layers)) {
                for (const [key, gid] of Object.entries(cells)) {
                    const [x, y] = key.split(",").map(Number);
                    tiles.push({ x, y, layerName, gid });
                }
            }
        }
        return new SetTilesFrontCommand(this.wamFile, tiles, undefined, this.gameMapFrontWrapper);
    }

    public emitEvent(roomConnection: RoomConnection): void {
        roomConnection.emitMapEditorClearTileOverlay(this.commandId);
    }
}

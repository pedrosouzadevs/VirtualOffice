import { SetTilesCommand } from "@workadventure/map-editor";
import type { TileChange, WamFile } from "@workadventure/map-editor";
import type { RoomConnection } from "../../../../../Connection/RoomConnection";
import type { GameMapFrontWrapper } from "../../../GameMap/GameMapFrontWrapper";
import type { FrontCommandInterface } from "../FrontCommandInterface";

export class SetTilesFrontCommand extends SetTilesCommand implements FrontCommandInterface {
    private readonly previousTiles: TileChange[];

    constructor(
        wamFile: WamFile,
        tiles: TileChange[],
        commandId: string | undefined,
        private gameMapFrontWrapper: GameMapFrontWrapper,
        previousTiles?: TileChange[],
    ) {
        super(wamFile, tiles, commandId);
        // Captured at construction time, and that is safe against resequencing: revertPendingCommands
        // undoes pending commands LIFO before any foreign command is applied, so at undo time each cell
        // holds exactly what it held when this stroke was painted.
        this.previousTiles =
            previousTiles ??
            this.tiles.map((tile) => ({
                x: tile.x,
                y: tile.y,
                layerName: tile.layerName,
                gid: gameMapFrontWrapper.getRawTileGidAt(tile.x, tile.y, tile.layerName) ?? 0,
            }));
    }

    public async execute(): Promise<void> {
        await super.execute();
        this.gameMapFrontWrapper.setTilesBatch(this.tiles);
    }

    public getUndoCommand(): SetTilesFrontCommand {
        // The undo writes the previous gids as overlay entries of their own. A cell whose previous value
        // came from the base .tmj thus gains an overlay entry holding that same value — visually identical,
        // and the consolidated export produces the same bytes either way (ADR-0007).
        return new SetTilesFrontCommand(
            this.wamFile,
            this.previousTiles,
            undefined,
            this.gameMapFrontWrapper,
            this.tiles,
        );
    }

    public emitEvent(roomConnection: RoomConnection): void {
        roomConnection.emitMapEditorSetTiles(this.commandId, this.tiles);
    }
}

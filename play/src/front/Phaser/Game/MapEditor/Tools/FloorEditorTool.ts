import type { EditMapCommandMessage } from "@workadventure/messages";
import type { GameMapFrontWrapper } from "../../GameMap/GameMapFrontWrapper";
import type { GameScene } from "../../GameScene";
import type { MapEditorModeManager } from "../MapEditorModeManager";
import { ClearTileOverlayFrontCommand } from "../Commands/Tiles/ClearTileOverlayFrontCommand";
import { SetTilesFrontCommand } from "../Commands/Tiles/SetTilesFrontCommand";
import { MapEditorTool } from "./MapEditorTool";

export class FloorEditorTool extends MapEditorTool {
    private scene: GameScene;
    private mapEditorModeManager: MapEditorModeManager;

    constructor(mapEditorModeManager: MapEditorModeManager) {
        super();
        this.mapEditorModeManager = mapEditorModeManager;
        this.scene = this.mapEditorModeManager.getScene();
    }

    public update(time: number, dt: number): void {
        // To implement
    }
    public clear(): void {
        // To implement
    }
    public activate(): void {
        // To implement
    }
    public destroy(): void {
        // To implement
    }
    public subscribeToGameMapFrontWrapperEvents(gameMapFrontWrapper: GameMapFrontWrapper): void {
        // To implement
    }
    public handleKeyDownEvent(event: KeyboardEvent): void {
        // To implement
    }
    /**
     * React on commands coming from the outside: another editor's stroke broadcast by the back, or the
     * join-time catch-up replay. Both build a fresh front command (fresh previous-gids at this moment)
     * and run it locally without re-emitting. Applying is idempotent — SetTiles writes absolute gids —
     * so a command already baked into the fetched WAM replaying here is a no-op.
     */
    public async handleIncomingCommandMessage(editMapCommandMessage: EditMapCommandMessage): Promise<void> {
        const message = editMapCommandMessage.editMapMessage?.message;
        const wamFile = this.scene.getGameMap().getWamFile();
        if (!message || !wamFile) {
            return;
        }
        switch (message.$case) {
            case "setTilesMessage": {
                await this.mapEditorModeManager.executeLocalCommand(
                    new SetTilesFrontCommand(
                        wamFile,
                        message.setTilesMessage.tiles,
                        editMapCommandMessage.id,
                        this.scene.getGameMapFrontWrapper(),
                    ),
                );
                break;
            }
            case "clearTileOverlayMessage": {
                await this.mapEditorModeManager.executeLocalCommand(
                    new ClearTileOverlayFrontCommand(
                        wamFile,
                        editMapCommandMessage.id,
                        this.scene.getGameMapFrontWrapper(),
                    ),
                );
                break;
            }
            default:
                break;
        }
    }
}

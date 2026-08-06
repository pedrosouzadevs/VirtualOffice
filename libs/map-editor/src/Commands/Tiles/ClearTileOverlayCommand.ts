import type { WamFile } from "../../GameMap/WamFile";
import { Command } from "../Command";

/**
 * Drops the whole tile overlay, reverting the map to its base .tmj (ADR-0007). This is the last step of the
 * commit flow: after the consolidated .tmj has been exported and PUT back, the overlay's job is done and
 * keeping it would double-apply on top of the new base.
 */
export class ClearTileOverlayCommand extends Command {
    protected wamFile: WamFile;

    constructor(wamFile: WamFile, commandId?: string) {
        super(commandId);
        this.wamFile = wamFile;
    }

    public execute(): Promise<void> {
        delete this.wamFile.getWam().tileOverlay;
        return Promise.resolve();
    }
}

import * as Phaser from "phaser";
import type { EditMapCommandMessage } from "@workadventure/messages";
import type { TileChange } from "@workadventure/map-editor";
import { GameMapProperties } from "@workadventure/map-editor";
import { get } from "svelte/store";
import type { GameMapFrontWrapper } from "../../GameMap/GameMapFrontWrapper";
import type { GameScene } from "../../GameScene";
import type { MapEditorModeManager } from "../MapEditorModeManager";
import {
    tileEditorAvailableLayersStore,
    tileEditorCollisionMarkerStore,
    tileEditorModeStore,
    tileEditorSelectedGidStore,
    tileEditorTargetLayerStore,
} from "../../../../Stores/TileEditorStore";
import { ClearTileOverlayFrontCommand } from "../Commands/Tiles/ClearTileOverlayFrontCommand";
import { SetTilesFrontCommand } from "../Commands/Tiles/SetTilesFrontCommand";
import { MapEditorTool } from "./MapEditorTool";

/** The layer wall collision markers live on. Painting it directly is never offered — see availableLayers. */
const COLLISIONS_LAYER_NAME = "collisions";

/**
 * The structural (tile) editor: paint floors, paint walls (visual tile + collision marker as one stroke),
 * erase. Gated by the adminMap tag end to end (ADR-0007); this tool is only reachable through gates that
 * checked it, and map-storage re-checks authoritatively.
 */
export class FloorEditorTool extends MapEditorTool {
    private scene: GameScene;
    private mapEditorModeManager: MapEditorModeManager;

    private active = false;
    private painting = false;
    /** Cells of the running brush stroke, deduped by "layer\nx,y" — one SetTiles command per stroke. */
    private strokeCells = new Map<string, TileChange>();
    private cellPreview: Phaser.GameObjects.Graphics | undefined;

    constructor(mapEditorModeManager: MapEditorModeManager) {
        super();
        this.mapEditorModeManager = mapEditorModeManager;
        this.scene = this.mapEditorModeManager.getScene();
    }

    public update(time: number, dt: number): void {
        // Pointer handlers drive everything; nothing to do per frame.
    }

    public clear(): void {
        this.active = false;
        this.painting = false;
        this.strokeCells.clear();
        this.scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.pointerDownHandler);
        this.scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.pointerMoveHandler);
        this.scene.input.off(Phaser.Input.Events.POINTER_UP, this.pointerUpHandler);
        this.scene.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.pointerUpHandler);
        this.cellPreview?.destroy();
        this.cellPreview = undefined;
    }

    public activate(): void {
        this.active = true;
        this.publishToolContext();
        this.cellPreview = this.scene.add.graphics();
        this.cellPreview.setDepth(10_000);
        this.scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.pointerDownHandler);
        this.scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.pointerMoveHandler);
        this.scene.input.on(Phaser.Input.Events.POINTER_UP, this.pointerUpHandler);
        this.scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.pointerUpHandler);
    }

    public destroy(): void {
        this.clear();
    }

    public subscribeToGameMapFrontWrapperEvents(gameMapFrontWrapper: GameMapFrontWrapper): void {
        // Nothing to subscribe to: the tool reads the wrapper on demand.
    }

    public handleKeyDownEvent(event: KeyboardEvent): void {
        // No keyboard shortcuts in the MVP.
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

    /**
     * Computes what the panel needs: paintable layers and the wall collision marker, both data-driven
     * from the loaded map. "collisions" (managed by Wall mode) and "start" (spawn semantics) are never
     * offered as paint targets.
     */
    private publishToolContext(): void {
        const gameMap = this.scene.getGameMap();

        const layers = gameMap.flatLayers
            .filter((layer) => layer.type === "tilelayer")
            .map((layer) => layer.name)
            .filter((name) => name !== COLLISIONS_LAYER_NAME && name !== "start");
        tileEditorAvailableLayersStore.set(layers);

        const currentTarget = get(tileEditorTargetLayerStore);
        if (!currentTarget || !layers.includes(currentTarget)) {
            const defaultLayer = layers.find((name) => name.toLowerCase().includes("floor")) ?? layers[0] ?? null;
            tileEditorTargetLayerStore.set(defaultLayer);
        }

        tileEditorCollisionMarkerStore.set(this.findCollisionMarker());
    }

    private findCollisionMarker(): { gid: number; layerName: string } | null {
        const gameMap = this.scene.getGameMap();
        const hasCollisionsLayer = gameMap.flatLayers.some(
            (layer) => layer.type === "tilelayer" && layer.name === COLLISIONS_LAYER_NAME,
        );
        if (!hasCollisionsLayer) {
            return null;
        }
        for (const tileset of gameMap.getMap().tilesets) {
            if (!("tiles" in tileset) || tileset.firstgid === undefined) {
                continue;
            }
            for (const tile of tileset.tiles ?? []) {
                const collides = tile.properties?.some(
                    (property) => property.name === GameMapProperties.COLLIDES && property.value === true,
                );
                if (collides) {
                    return { gid: tileset.firstgid + tile.id, layerName: COLLISIONS_LAYER_NAME };
                }
            }
        }
        return null;
    }

    private pointerDownHandler = (pointer: Phaser.Input.Pointer): void => {
        if (!this.active || !pointer.leftButtonDown()) {
            return;
        }
        this.painting = true;
        this.strokeCells.clear();
        this.paintCellAtPointer(pointer);
    };

    private pointerMoveHandler = (pointer: Phaser.Input.Pointer): void => {
        if (!this.active) {
            return;
        }
        this.updateCellPreview(pointer);
        if (this.painting) {
            this.paintCellAtPointer(pointer);
        }
    };

    private pointerUpHandler = (): void => {
        if (!this.active || !this.painting) {
            return;
        }
        this.painting = false;
        const tiles = [...this.strokeCells.values()];
        this.strokeCells.clear();
        if (tiles.length === 0) {
            return;
        }
        const wamFile = this.scene.getGameMap().getWamFile();
        if (!wamFile) {
            return;
        }
        this.mapEditorModeManager
            .executeCommand(new SetTilesFrontCommand(wamFile, tiles, undefined, this.scene.getGameMapFrontWrapper()))
            .catch((e) => console.error("Failed to execute SetTiles command", e));
    };

    private paintCellAtPointer(pointer: Phaser.Input.Pointer): void {
        const cell = this.pointerToCell(pointer);
        if (!cell) {
            return;
        }
        const targetLayer = get(tileEditorTargetLayerStore);
        if (!targetLayer) {
            return;
        }
        const mode = get(tileEditorModeStore);
        const marker = get(tileEditorCollisionMarkerStore);

        if (mode === "erase") {
            this.addStrokeCell({ x: cell.x, y: cell.y, layerName: targetLayer, gid: 0 });
            // The collision marker is invisible; leaving it orphaned would recreate the phantom-wall
            // problem, so erasing always releases the cell's collision too (ADR-0007).
            if (marker) {
                this.addStrokeCell({ x: cell.x, y: cell.y, layerName: marker.layerName, gid: 0 });
            }
            return;
        }

        const selectedGid = get(tileEditorSelectedGidStore);
        if (selectedGid === null) {
            return;
        }
        this.addStrokeCell({ x: cell.x, y: cell.y, layerName: targetLayer, gid: selectedGid });
        if (mode === "wall" && marker) {
            this.addStrokeCell({ x: cell.x, y: cell.y, layerName: marker.layerName, gid: marker.gid });
        }
    }

    private addStrokeCell(tile: TileChange): void {
        this.strokeCells.set(`${tile.layerName}\n${tile.x},${tile.y}`, tile);
    }

    private pointerToCell(pointer: Phaser.Input.Pointer): { x: number; y: number } | undefined {
        const gameMap = this.scene.getGameMap();
        const { width: tileWidth, height: tileHeight } = gameMap.getTileDimensions();
        const x = Math.floor(pointer.worldX / tileWidth);
        const y = Math.floor(pointer.worldY / tileHeight);
        const map = gameMap.getMap();
        if (x < 0 || y < 0 || x >= (map.width ?? 0) || y >= (map.height ?? 0)) {
            return undefined;
        }
        return { x, y };
    }

    private updateCellPreview(pointer: Phaser.Input.Pointer): void {
        if (!this.cellPreview) {
            return;
        }
        this.cellPreview.clear();
        const cell = this.pointerToCell(pointer);
        if (!cell) {
            return;
        }
        const { width: tileWidth, height: tileHeight } = this.scene.getGameMap().getTileDimensions();
        const color = get(tileEditorModeStore) === "erase" ? 0xff5555 : 0x55ff88;
        this.cellPreview.lineStyle(2, color, 0.9);
        this.cellPreview.strokeRect(cell.x * tileWidth, cell.y * tileHeight, tileWidth, tileHeight);
    }
}

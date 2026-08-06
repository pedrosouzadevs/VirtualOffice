<script lang="ts">
    import { onMount } from "svelte";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import {
        tileEditorAvailableLayersStore,
        tileEditorCollisionMarkerStore,
        tileEditorModeStore,
        tileEditorSelectedGidStore,
        tileEditorTargetLayerStore,
        type TileEditorMode,
    } from "../../../Stores/TileEditorStore";

    type PaletteTileset = {
        name: string;
        imageUrl: string;
        firstgid: number;
        columns: number;
        tilecount: number;
        tileWidth: number;
        tileHeight: number;
        imageWidth: number;
    };

    // 32px tiles render at 48px — comfortable to hit without dwarfing the palette.
    const DISPLAY_SCALE = 1.5;

    let tilesets = $state<PaletteTileset[]>([]);
    let openTileset = $state<string | null>(null);

    onMount(() => {
        const scene = gameManager.getCurrentGameScene();
        const map = scene.getGameMap().getMap();
        // Tileset image paths are relative to the .tmj, exactly like the Phaser loader resolves them.
        const baseUrl = scene.mapUrlFile;
        tilesets = map.tilesets.flatMap((tileset) => {
            if (!("image" in tileset) || !tileset.image || tileset.firstgid === undefined) {
                return [];
            }
            const tileWidth = tileset.tilewidth ?? 32;
            const columns = tileset.columns && tileset.columns > 0 ? tileset.columns : 1;
            return [
                {
                    name: tileset.name ?? "tileset",
                    imageUrl: new URL(tileset.image, baseUrl).toString(),
                    firstgid: tileset.firstgid,
                    columns,
                    tilecount: tileset.tilecount ?? 0,
                    tileWidth,
                    tileHeight: tileset.tileheight ?? 32,
                    imageWidth: tileset.imagewidth ?? columns * tileWidth,
                },
            ];
        });
        openTileset = tilesets[0]?.name ?? null;
    });

    const modes: { id: TileEditorMode; testId: string }[] = [
        { id: "paint", testId: "tileEditorModePaint" },
        { id: "wall", testId: "tileEditorModeWall" },
        { id: "erase", testId: "tileEditorModeErase" },
    ];

    function modeLabel(mode: TileEditorMode): string {
        switch (mode) {
            case "paint":
                return $LL.mapEditor.floorEditor.modePaint();
            case "wall":
                return $LL.mapEditor.floorEditor.modeWall();
            case "erase":
                return $LL.mapEditor.floorEditor.modeErase();
        }
    }
</script>

<div class="flex flex-col gap-4 overflow-y-auto" data-testid="tileEditorPanel">
    <div class="flex flex-row gap-2">
        {#each modes as mode (mode.id)}
            <button
                type="button"
                class="flex-1 p-2 rounded {$tileEditorModeStore === mode.id
                    ? 'bg-secondary'
                    : 'bg-white/10 hover:bg-white/20'}"
                data-testid={mode.testId}
                onclick={() => tileEditorModeStore.set(mode.id)}
            >
                {modeLabel(mode.id)}
            </button>
        {/each}
    </div>

    {#if $tileEditorModeStore === "wall" && !$tileEditorCollisionMarkerStore}
        <div class="p-2 rounded bg-warning/30 text-sm" data-testid="tileEditorWallDegraded">
            {$LL.mapEditor.floorEditor.wallModeDegraded()}
        </div>
    {/if}

    <label class="flex flex-col gap-1">
        <span class="text-sm opacity-80">{$LL.mapEditor.floorEditor.targetLayer()}</span>
        <select
            class="p-2 rounded bg-contrast text-white"
            data-testid="tileEditorLayerSelect"
            bind:value={$tileEditorTargetLayerStore}
        >
            {#each $tileEditorAvailableLayersStore as layerName (layerName)}
                <option value={layerName}>{layerName}</option>
            {/each}
        </select>
    </label>

    {#if $tileEditorModeStore !== "erase"}
        <span class="text-l">{$LL.mapEditor.floorEditor.palette()}</span>
        {#if $tileEditorSelectedGidStore === null}
            <span class="text-sm opacity-80">{$LL.mapEditor.floorEditor.selectTileHint()}</span>
        {/if}
        {#each tilesets as tileset (tileset.name)}
            <div class="flex flex-col gap-1">
                <button
                    type="button"
                    class="text-start text-sm p-1 rounded bg-white/10 hover:bg-white/20"
                    onclick={() => (openTileset = openTileset === tileset.name ? null : tileset.name)}
                >
                    {openTileset === tileset.name ? "▾" : "▸"}
                    {tileset.name}
                </button>
                {#if openTileset === tileset.name}
                    <div
                        class="grid gap-0 overflow-x-auto"
                        style="grid-template-columns: repeat({tileset.columns}, {tileset.tileWidth * DISPLAY_SCALE}px);"
                    >
                        {#each Array(tileset.tilecount) as _, index (index)}
                            {@const gid = tileset.firstgid + index}
                            <button
                                type="button"
                                aria-label="tile {gid}"
                                class="p-0 m-0 border {$tileEditorSelectedGidStore === gid
                                    ? 'border-secondary border-2'
                                    : 'border-transparent'}"
                                data-testid="tileEditorPaletteTile"
                                style="width: {tileset.tileWidth * DISPLAY_SCALE}px; height: {tileset.tileHeight *
                                    DISPLAY_SCALE}px; background-image: url('{tileset.imageUrl}'); background-position: -{(index %
                                    tileset.columns) *
                                    tileset.tileWidth *
                                    DISPLAY_SCALE}px -{Math.floor(index / tileset.columns) *
                                    tileset.tileHeight *
                                    DISPLAY_SCALE}px; background-size: {tileset.imageWidth *
                                    DISPLAY_SCALE}px auto; image-rendering: pixelated;"
                                onclick={() => tileEditorSelectedGidStore.set(gid)}
                            ></button>
                        {/each}
                    </div>
                {/if}
            </div>
        {/each}
    {:else}
        <span class="text-sm opacity-80">{$LL.mapEditor.floorEditor.eraseHint()}</span>
    {/if}
</div>

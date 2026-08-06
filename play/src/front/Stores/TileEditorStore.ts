import { writable } from "svelte/store";

export type TileEditorMode = "paint" | "wall" | "erase";

/** Active brush mode of the structural (tile) editor — see FloorEditorTool (ADR-0007). */
export const tileEditorModeStore = writable<TileEditorMode>("paint");

/** Raw gid selected in the palette, or null when nothing is selected yet. */
export const tileEditorSelectedGidStore = writable<number | null>(null);

/** Flat tile layer the brush paints on. */
export const tileEditorTargetLayerStore = writable<string | null>(null);

/** Paintable flat tile layer names, computed by the tool on activation ("collisions"/"start" excluded). */
export const tileEditorAvailableLayersStore = writable<string[]>([]);

/**
 * Data-driven wall support: the first tileset gid carrying collides:true plus the literal "collisions"
 * layer. Null when the map has neither — Wall mode then degrades to visual-only and the panel says so.
 */
export const tileEditorCollisionMarkerStore = writable<{ gid: number; layerName: string } | null>(null);

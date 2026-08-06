# ADR-0007: In-game structural editing as a WAM tile overlay, gated by `adminMap`

- **Status:** Accepted
- **Date:** 2026-08-06
- **Deciders:** ArqueumSpace team
- **Languages:** this file (en-US) + [0007-tile-overlay-map-editing.pt-BR.md](0007-tile-overlay-map-editing.pt-BR.md), in lockstep
- **Origin:** product request (2026-08-05): edit the map's structure — floors, walls, entrances, exits — inside
  the game, allowed only by a new `adminMap` tag. Exits and spawns turned out to already be editable in-game
  (area properties `exit`/`start`); the real gap was tiles.

## Context

The in-game editor edits the `.wam` overlay (entities, areas, settings). The `.tmj` authored in Tiled owns the
geometry and is immutable after upload: no edit command touches it, the JSON-Patch endpoint is regex-locked to
`.wam`, the back memoizes its parsed copy per room forever, and nothing notifies clients when its bytes change.
The upstream left a seam: `FloorEditorTool` existed as a registered, empty stub, reachable by `#mapEditor=floor`
but absent from the sidebar. The scripting API could already place tiles client-side (`WA.room.setTiles` →
`putTile`), session-local and unsynchronised — proof the Phaser side was feasible, with two bugs to avoid
inheriting: `putTile` never *cleared* collision (phantom colliders), and GPU layers silently refuse tiles from a
second tileset.

## Decision 1 — `adminMap` opens the full editor; tiles accept **only** `adminMap`

The tag is free-form data (grantable through the dashboard and CLI with zero schema change) and joins
`MAP_EDITOR_TAGS`, so it opens the whole editor (objects, areas, tiles) and is pre-created at bootstrap. The
tile commands themselves are accepted **only** when the user's tags include `adminMap` — deliberately **no
`admin` or `editor` override**, per the product decision ("apenas permitido pela tag adminMap"). An
administrator grants the tag to themselves through the dashboard; it stays out of `PROTECTED_TAGS`.

The single predicate `canEditTiles` lives in `libs/map-editor` (`TILE_EDITOR_TAGS`), imported by the front (tool
visibility, deep link), the pusher (cheap pre-gate answering the same `errorCommandMessage` shape) and
map-storage — **the authoritative check**, a `throw` placed before anything is queued or echoed, which the outer
catch turns into a real `errorCommandMessage`. This is intentionally NOT the `EntityPermissions` pattern, whose
Sentry-and-break path lets a refused command be queued and echoed as success.

## Decision 2 — Edits persist as a tile overlay in the `.wam`; the `.tmj` stays untouched

`WAMFileFormat` gains an optional `tileOverlay`: `{ layers: { [flatLayerName]: { "x,y": gid } } }`.

- **Flat dict, last-write-wins**: the WAM is zod-re-validated after every command and serialized whole by the
  15s autosave, so the overlay must be O(cells touched), never O(edits made).
- **Raw gids, flip flags included** (hence uint32); consolidation writes them verbatim. In-game they render
  unrotated (Phaser carries flips on Tile properties, not indices) — an accepted MVP limitation.
- **gid 0 is an explicit erase**, distinct from an absent key: erasing a tile the base `.tmj` painted must
  survive consolidation.
- **Layer keys are the FLATTENED names** (`walls/walls1`), matching `GameMap.flatLayers`, the Phaser layers and
  `WA.room.setTiles`.
- **Server caps**: 2048 cells per stroke, ~50k overlay cells; past that, consolidate.

### Alternatives considered

- **Write the `.tmj` directly** — the Tiled file stays the single truth, but every piece of machinery is
  missing: no server-side write path (PUT is whole-file, re-validating 10 tileset images per save), no change
  notification, an eternally stale parsed copy in the back, browser/Phaser caches. Rejected: all risk, no
  pipeline reuse.
- **A patch list instead of a dict** — grows unboundedly under repainting; rejected.

Riding the `.wam` means the entire proven pipeline — per-map lock, autosave, zod validation, join-time
command catch-up, `refreshRoomMessage` — works unchanged. New transport: `SetTilesMessage` (one brush stroke)
and `ClearTileOverlayMessage`, `EditMapMessage` fields 14/15. The `apiVersionHash` bump is automatic (every
Dockerfile runs `tag-version` at build), so pre-deploy tabs are refused and reload instead of going blind to
tile broadcasts.

## Decision 3 — Round-trip to Tiled is a manual commit flow

"Saving to `.tmj`" is three explicit steps, not a side effect of editing:

1. **Download** `<wam-url>?consolidated-tmj` — the base `.tmj` with the overlay baked in
   (`applyTileOverlayToTmj`, nothing else touched, so it passes the upload validator unchanged). Served from
   the wam's own URL, the one address the front knows in every deploy topology. **Public**, like the `.wam`
   and `.tmj` themselves: the overlay is broadcast to every connected client anyway.
2. **Re-upload** it through the existing authenticated PUT (or the Tiled → zip → upload flow).
3. **Clear the overlay** in the editor. The server pairs this with the map-upload refresh mechanism — every
   back is told, sends `refreshRoomMessage` (30s countdown), and evicts caches — because connected clients
   hold the old overlay baked into their in-memory tilemaps and must reload into the new base. Before that
   refresh, map-storage **flushes the WAM to storage** (`MapsManager.flushMapToStorage`): the eviction path
   drops the in-memory copy without saving, and a clear younger than the autosave would otherwise resurrect
   from the stale file.

## Decision 4 — MVP scope cuts

- **No canvas resize.** office.tmj is declared 144×128 with 31×21 drawn (~3.5%): "growing the office" is
  painting into space that already exists. Resizing means Tiled desktop + re-upload.
- **No runtime tileset upload, no layer management.** New tilesets arrive by editing in Tiled and re-uploading
  — the flow that already exists.
- **Wall mode is a paired paint**, data-driven: the visual gid on the chosen layer plus the collision-marker
  gid on the literal `collisions` layer, both cells in one command. The marker is the first tileset tile with
  `collides: true`. Without marker or layer, Wall degrades to visual-only with a panel notice.
- **The eraser always releases the cell's collision too.** An invisible orphaned collider is the phantom-wall
  problem; a visibly missing floor tile is self-explanatory and repaintable.
- **`collisions` and `start` are never offered as paint targets** (managed by Wall mode / spawn semantics).
- **GPU single-tileset layers**: eligibility now unions overlay gids at load, so an overlay bringing a second
  tileset demotes the layer to CPU instead of silently dropping cells; live painting across tilesets on a GPU
  layer is refused with a console warning (the palette restriction is the UX answer).

## Consequences

### Positive

- The `.tmj` remains the pristine Tiled artifact; "undo everything" is one clear-overlay away.
- Every existing guarantee (locks, autosave, validation, catch-up, undo/redo) applies to tiles for free; a
  server-refused stroke now rolls back visually on the author's screen (gap found and fixed in the
  `errorCommandMessage` branch, scoped to tile commands).
- The phantom-collider bug in `putTile` is fixed for every caller, scripting API included.

### Negative

- Undoing a stroke writes the previous gids as overlay entries of their own (a base-value cell gains a
  redundant overlay entry). Harmless: consolidation output is identical.
- Clearing the overlay reloads every connected client (30s countdown) even when no re-upload happened —
  accepted for an administrative, rare operation.
- Flip-flagged overlay cells render unrotated in-game until consolidation.
- A stroke crossing another editor's concurrent stroke resolves last-write-wins per cell, like every other
  editor command.

### Neutral

- `MemberAdministrationService` and the dashboard grant `adminMap` like any tag; only `admin` stays SQL-only.
- The consolidated export loads the WAM into map-storage memory (eviction reclaims it); it does not start an
  autosave timer.

## References

- [ADR-0002](0002-admin-api.md) (contract, tags-from-database), [ADR-0004](0004-admin-dashboard.md) (grant surfaces)
- Operations guide: [MAP-STRUCTURAL-EDITING.md](../MAP-STRUCTURAL-EDITING.md) / [pt-BR](../MAP-STRUCTURAL-EDITING.pt-BR.md)
- Key files: `libs/map-editor/src/Commands/Tiles/*`, `libs/map-editor/src/GameMap/TileOverlayMerge.ts`,
  `play/src/front/Phaser/Game/MapEditor/Tools/FloorEditorTool.ts`,
  `play/src/front/Phaser/Game/GameMap/GameMapFrontWrapper.ts` (`setTilesBatch`),
  `map-storage/src/MapStorageServer.ts` (gate + cases), `map-storage/src/index.ts` (`?consolidated-tmj`)

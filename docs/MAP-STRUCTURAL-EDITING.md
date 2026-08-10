# Structural map editing (tiles) — operations guide

> **Purpose.** How to grant, use and commit in-game structural edits (floors and walls). Design rationale:
> [ADR-0007](adr/0007-tile-overlay-map-editing.md).
> **Audience.** World administrators.
> **Prerequisites.** A running stack with `ADMIN_API_URL` set, and a map served by map-storage (a `/~/` room).

## Granting access

Structural editing is allowed **only** by the `adminMap` tag — `admin` and `editor` get no override. The tag is
pre-created at bootstrap and grantable like any other:

- **Dashboard:** `/admin/` → member → add tag `adminMap`.
- **CLI:**

```bash
docker compose exec admin-api npm run member:grant -- someone@company.com adminMap
```

The person must **log out and log back in** after a grant — a plain reload is not enough, because tags stick
to the login session (verified empirically while smoke-testing: the e2e only sees a granted tag after a fresh
login). `adminMap` also opens the full editor (objects and areas), so it is the only tag a map maintainer
needs.

## Using the editor

Open the map editor → grid icon ("Tile editor tool", visible only with `adminMap`):

| Mode | What it does |
|---|---|
| **Floor** | Paints the selected palette tile on the chosen layer. |
| **Wall** | Paints the tile AND marks the cell as colliding (marker tile on the `collisions` layer), one stroke. |
| **Eraser** | Clears the cell on the chosen layer AND releases its collision. |

Click or drag; each drag is one undoable stroke (Ctrl+Z). Edits reach everyone in the room live, persist as a
**tile overlay in the `.wam`** (the authored `.tmj` is never modified), and survive reloads.

Notes:

- The `collisions` and `start` layers are never offered as paint targets.
- The office map is 144×128 tiles with only ~31×21 drawn: grow the office by painting into the empty canvas.
- Limits: 2048 cells per stroke, ~50k overlay cells total. Past that, commit (below) and clear.
- New tilesets: add them in Tiled desktop and re-upload the map — there is no runtime tileset upload.

## Committing edits back to Tiled (the round-trip)

The overlay is not the `.tmj`. To make the edits part of the base map file:

1. **Download** the consolidated map: the "Download consolidated .tmj" button in the tile editor panel, or

```bash
curl -o office-consolidated.tmj "https://<domain>/map-storage/maps/office.wam?consolidated-tmj"
```

2. **Verify it in Tiled desktop** (optional but recommended), then **re-upload** it over the original `.tmj`
   through `/map-storage/` (basic auth), keeping the same file name.
3. **Clear the overlay**: "Clear structural edits" in the panel. Everyone in the room gets a 30-second refresh
   countdown and reloads into the new base map. This is deliberate — connected clients hold the old overlay in
   memory and must reload.

> Skipping step 3 is harmless visually (the overlay re-applies the same gids over the new base) but keeps the
> overlay growing; skipping step 2 and clearing anyway simply reverts the world to the old base map.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| No grid icon in the editor sidebar | The user lacks `adminMap`, or did not log out/in after the grant (tags stick to the login session). |
| "walls will be visual only" notice | The map has no tileset tile with `collides: true` or no `collisions` layer. Add them in Tiled. |
| A stroke disappears right after painting | The server refused it (no `adminMap` server-side). The rollback is intentional. |
| Painted tile shows no rotation | Flip-flagged gids render unrotated in-game; the consolidated export keeps the flags (ADR-0007). |
| `?consolidated-tmj` answers 400 | The `.wam`'s `mapUrl` is absolute/external; only relative maps can be consolidated. |

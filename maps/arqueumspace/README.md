# ArqueumSpace office map

The map served as the world's start room. Upload it to `map-storage` and point `START_ROOM_URL` at it.

## What is here

| File | Role |
|---|---|
| `office.tmj` | The office. The start room. |
| `conference.tmj` | Travels with it: the office has an exit into it (`to-conference` → `conference.tmj#from-office`), so shipping office alone would put a door in the map that leads nowhere. |
| `office.png`, `conference.png` | Thumbnails, referenced by each map's `mapImage` property. |
| `tilesets/` | Every tileset both maps use, flattened. |

## How it was built, and what changed from the authored source

The map is drawn in Tiled in a separate project (`WorkAdventure-Map`), where the tilesets sit in a sibling folder.
Its `.tmj` therefore points at `../../../WorkAdventure-Map/tilesets/…`, which resolves on the machine it was drawn
on and nowhere else. Packaging rewrites those paths to `tilesets/…` and copies the images in.

Two other changes, both deliberate:

- **The `script` property was dropped.** It pointed at `src/main.ts`, the starter kit's demo script (a clock popup),
  which is TypeScript needing a build step and somewhere to be served from. Every other property these maps use —
  `focusable`, `jitsiRoom`, `jitsiTrigger`, `silent`, `exitUrl`, `zoom_margin` — is native to the engine. What is
  lost is the clock popup on two areas nothing else references.
- **The JSON is minified.** Indentation doubled the file for a document nobody reads by hand.

## Re-packaging after editing in Tiled

Edit in the Tiled project as usual, then rebuild this folder and the upload archive:

```bash
node maps/build-arqueumspace-maps.js
```

## Size

`office.tmj` is 405 KB for **1394 drawn tiles**, because the map is declared 144×128 (18 432 cells) while the drawing
occupies **31×21 — about 3.5% of it**. Every layer still stores a full-size array of mostly zeros.

Cropping to the used area in Tiled (*Map → Resize Map*, with the offset set so the drawing stays put) would cut the
file by roughly 96%. It is left to Tiled on purpose: cropping shifts every coordinate, and the object layer holds the
spawn point, the Jitsi zones, the silent zone and both exits — Tiled moves those with the map, a script editing JSON
would have to get that arithmetic right on its own.

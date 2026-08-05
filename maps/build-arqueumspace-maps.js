/**
 * Packages the ArqueumSpace maps for map-storage.
 *
 * The maps are authored in a separate Tiled project whose tilesets live in a sibling folder, so their `.tmj` files
 * reference `../../../WorkAdventure-Map/tilesets/…` — paths that resolve on the machine they were drawn on and
 * nowhere else. This flattens every asset into `maps/arqueumspace/` and rewrites the references to match.
 *
 * See maps/arqueumspace/README.md for what else changes and why.
 *
 * Usage: node maps/build-arqueumspace-maps.js [path-to-tiled-project]
 */
const fs = require("fs");
const path = require("path");

const SOURCE = process.argv[2] ?? "C:/WorkAdventure-Map";
const REPO = path.resolve(__dirname, "..");
const OUT = path.join(REPO, "maps/arqueumspace");

/**
 * `office.tmj` is taken from this repository because it is the copy being edited; `conference.tmj` comes from the
 * Tiled project. Both end up side by side, which is what makes the office's exit into the conference resolve.
 */
const MAPS = [
    { name: "office.tmj", from: path.join(REPO, "maps/assets/office.tmj") },
    { name: "conference.tmj", from: path.join(SOURCE, "conference.tmj") },
];

if (!fs.existsSync(SOURCE)) {
    console.error(`Tiled project not found at ${SOURCE}. Pass its path as the first argument.`);
    process.exit(2);
}

// The README is written by hand and lives here; keep it while everything else is regenerated.
const readme = path.join(OUT, "README.md");
const keptReadme = fs.existsSync(readme) ? fs.readFileSync(readme) : undefined;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "tilesets"), { recursive: true });
if (keptReadme) fs.writeFileSync(readme, keptReadme);

const staged = new Set();

/** Copies a tileset image from wherever it actually lives and returns the path the packaged map should use. */
function stageTileset(image) {
    const base = image.split("/").pop();

    if (!staged.has(base)) {
        const candidates = [
            path.join(SOURCE, "tilesets", base),
            path.join(REPO, "maps/assets", base),
            path.join(SOURCE, base),
        ];
        const found = candidates.find((candidate) => fs.existsSync(candidate));

        if (found === undefined) {
            console.error(`Tileset not found anywhere: ${base}`);
            process.exit(1);
        }

        fs.copyFileSync(found, path.join(OUT, "tilesets", base));
        staged.add(base);
    }

    return `tilesets/${base}`;
}

for (const map of MAPS) {
    if (!fs.existsSync(map.from)) {
        console.error(`Map not found: ${map.from}`);
        process.exit(1);
    }

    const doc = JSON.parse(fs.readFileSync(map.from, "utf8"));

    for (const tileset of doc.tilesets ?? []) {
        if (tileset.image) tileset.image = stageTileset(tileset.image);
    }

    doc.properties = (doc.properties ?? [])
        // No script ships with the package, so a reference to one only produces a console error on every load.
        .filter((property) => property.name !== "script")
        // The copyright credits the tileset authors and stays verbatim — it is an attribution, not branding.
        .map((property) =>
            property.name === "mapDescription"
                ? { ...property, value: "The ArqueumSpace virtual office." }
                : property,
        );

    // Minified: indentation doubled the file for a document nobody reads by hand.
    fs.writeFileSync(path.join(OUT, map.name), JSON.stringify(doc));

    const thumbnail = doc.properties.find((property) => property.name === "mapImage");
    if (thumbnail) {
        const from = path.join(SOURCE, thumbnail.value);
        if (fs.existsSync(from)) {
            fs.copyFileSync(from, path.join(OUT, thumbnail.value));
        } else {
            console.warn(`Thumbnail declared but missing, ${map.name} will show none: ${thumbnail.value}`);
        }
    }

    const drawn = countDrawnTiles(doc);
    console.log(`${map.name}: ${doc.tilesets.length} tilesets, ${drawn} tiles drawn of ${doc.width * doc.height} cells`);
}

/** How many cells actually carry a tile — the gap against width*height is what makes a sparse map heavy. */
function countDrawnTiles(doc) {
    const GID_MASK = 0x1fffffff;
    let total = 0;

    const walk = (layers) => {
        for (const layer of layers) {
            if (layer.layers) walk(layer.layers);
            if (layer.type === "tilelayer" && Array.isArray(layer.data)) {
                for (const gid of layer.data) if ((gid & GID_MASK) > 0) total++;
            }
        }
    };
    walk(doc.layers);

    return total;
}

console.log(`\n${staged.size} tilesets staged into ${path.relative(REPO, OUT)}`);
console.log("Archive for upload:  docker run --rm -v \"$PWD/maps:/m\" alpine sh -c \"apk add --no-cache zip >/dev/null && cd /m/arqueumspace && zip -r -q /m/arqueumspace-maps.zip .\"");

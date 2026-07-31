/**
 * A room in the world, as the dashboard shows it.
 *
 * Assembled from what `map-storage` publishes at `/maps` plus the public URL a browser would use. Read-only: the
 * dashboard shows rooms so an administrator can see what exists and follow a link, and editing a map is the map
 * editor's job (ADR-0004, G3).
 */
export interface Room {
    /** The path within map-storage, e.g. `maps/areas.wam`. Unique, and what the other two are built from. */
    readonly path: string;

    /** The in-world address, e.g. `/~/maps/areas.wam`. What `play` routes on. */
    readonly roomUrl: string;

    /** The absolute URL of the WAM file, built from the public map-storage address. */
    readonly wamUrl: string;

    /** The map's own name, or the path when it has none — a room is always identifiable by something. */
    readonly name: string;

    readonly description: string | undefined;
    readonly thumbnail: string | undefined;
}

/**
 * An area drawn inside a map: a personal desk, a silent zone, a meeting spot.
 *
 * This is what an administrator actually asks about — "who owns that desk", "which rooms are silent" — and none of it
 * is visible anywhere else without opening the map editor.
 */
export interface Area {
    readonly id: string;

    /** The name given in the map editor. May be empty; the screen falls back to the id. */
    readonly name: string;

    /**
     * The property types the area carries, e.g. `personalAreaPropertyData`, `silent`, `livekitRoomProperty`.
     *
     * Kept as the raw type strings rather than a curated enum: the map editor gains properties over time, and a list
     * that silently omits the one somebody is looking for is worse than one with an unfamiliar name in it.
     */
    readonly kinds: string[];

    /** Present only on a personal area. */
    readonly personal: PersonalAreaDetails | undefined;
}

export interface PersonalAreaDetails {
    /**
     * The owner, as the map stores it — an **email**, because that is what `/api/room/access` returns as `userUuid`
     * and what the front writes into `personalAreaPropertyData.ownerId` (ADR-0002, invariant #2).
     *
     * `null` when the area is unclaimed.
     */
    readonly ownerId: string | null;

    /** The owner's display name, when we have a member row for them. */
    readonly ownerName: string | null;

    /** True when the email has no member row at all — usually an area claimed before the Admin API was switched on. */
    readonly ownerUnknown: boolean;

    /** Tags that may claim the area, when the map gates it that way. */
    readonly allowedTags: string[];

    /** How the area is claimed, e.g. `dynamic` or `static`. Verbatim from the map. */
    readonly accessClaimMode: string | undefined;
}

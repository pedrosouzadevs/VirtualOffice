import type { ShortMapDescription } from "@workadventure/messages";
import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { RoomCatalogueUnavailable, type RoomCatalogue } from "../../Application/Ports/RoomCatalogue";
import type { Room } from "../../Domain/Room";

/**
 * What `GET /api/room/sameWorld` receives.
 *
 * The route is `sameWorld`, not the `/api/room/same` the phase description named (ADR-0005, correction #4).
 */
const SameWorldQuery = z.object({
    roomUrl: z.string().min(1),

    /**
     * Declared to document the wire shape, and deliberately never read.
     *
     * `tags` arrives **comma-joined into one parameter** — `url.searchParams.append("tags", tags.join(","))` — which
     * is the exact opposite of `characterTextureIds`, where axios repeats the key and the `extended` query parser
     * folds it back into an array (ADR-0005, correction #5). `bypassTagFilter` arrives as the *string* `"true"` or
     * `"false"`, from `String(bypassTagFilter)`.
     *
     * Typed as unknown rather than as a string so that a caller sending either one differently can never turn this
     * endpoint into a 400. The answer does not depend on them: nothing in our data model expresses "this room
     * requires that tag" — that lives in the map — so P3 returns every room, which is what `LocalAdmin` does today
     * (ADR-0005, decision #5).
     */
    tags: z.unknown().optional(),
    bypassTagFilter: z.unknown().optional(),
});

/** Turns a room into the entry the pusher parses, metadata fields at the top level where the schema merges them. */
function toShortMapDescription(room: Room): ShortMapDescription {
    return {
        name: room.name,
        roomUrl: room.roomUrl,
        wamUrl: room.wamUrl,
        description: room.description,
        thumbnail: room.thumbnail,
        copyright: room.copyright,
        areasSearchable: room.areasSearchable,
        entitiesSearchable: room.entitiesSearchable,
    };
}

/**
 * `GET /api/room/sameWorld` — every room of the world (ADR-0005, H2).
 *
 * Called by `SocketManager.emitPlayGlobalMessage` when an administrator broadcasts to the whole world, and by
 * `handleRoomsFromSameWorldQuery` behind the room-exploration screen. Neither is capability-gated, so both have been
 * reaching our 404 since `ADMIN_API_URL` was set: the broadcast threw, and the exploration screen answered an error.
 *
 * A mapping over the catalogue G3 already built, not a new integration — `map-storage` is read in exactly one place.
 */
export class SameWorldController {
    constructor(
        private readonly app: Express,
        /** Absent when `INTERNAL_MAP_STORAGE_URL` is unset. */
        private readonly rooms: RoomCatalogue | undefined,
    ) {
        this.listRoomsFromSameWorld();
    }

    private listRoomsFromSameWorld(): void {
        this.app.get("/api/room/sameWorld", (req: Request, res: Response, next: NextFunction) => {
            (async () => {
                const query = SameWorldQuery.safeParse(req.query);

                if (!query.success) {
                    res.status(400).json({
                        status: "error",
                        type: "error",
                        code: "INVALID_SAME_WORLD_QUERY",
                        title: "Invalid request",
                        subtitle: "",
                        details: "roomUrl is required and must be a string.",
                    });
                    return;
                }

                if (this.rooms === undefined) {
                    // 501, not an empty list. An empty answer would be a *lie shaped like a success*: the broadcast
                    // would reach nobody and the administrator would see it succeed, which is the class of silent
                    // failure this whole ADR exists to remove.
                    res.status(501).json({
                        status: "error",
                        type: "error",
                        code: "ADMIN_ROOMS_NOT_CONFIGURED",
                        title: "Rooms unavailable",
                        subtitle: "",
                        details: "INTERNAL_MAP_STORAGE_URL is not set, so the room catalogue cannot be read.",
                    });
                    return;
                }

                // `roomUrl` identifies the caller's room. With one world (ADR-0002, decision #7) every room is in it,
                // so it narrows nothing yet; it becomes the scope filter when worlds arrive.
                res.status(200).json((await this.rooms.listRooms()).map(toShortMapDescription));
            })().catch((error: unknown) => {
                if (error instanceof RoomCatalogueUnavailable) {
                    // 502, and said plainly: map-storage's outage, not ours. The caller retries or degrades; what it
                    // must not do is treat "I could not ask" as "there are no other rooms".
                    console.warn(`[${new Date().toISOString()}] The room catalogue is unavailable`, error);
                    res.status(502).json({
                        status: "error",
                        type: "error",
                        code: "ADMIN_ROOMS_UNAVAILABLE",
                        title: "Rooms unavailable",
                        subtitle: "",
                        details: "map-storage could not be reached.",
                    });
                    return;
                }

                console.error(`[${new Date().toISOString()}] Failed to list the rooms of the world`, error);
                next(error);
            });
        });
    }
}

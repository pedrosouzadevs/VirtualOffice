import type { Express, NextFunction, Request, Response } from "express";
import { resolveAreaOwners } from "../../Application/AreaOwnerResolver";
import type { MemberRepository } from "../../Application/Ports/MemberRepository";
import { RoomCatalogueUnavailable, type RoomCatalogue } from "../../Application/Ports/RoomCatalogue";

/**
 * `GET /admin/api/rooms` and `GET /admin/api/rooms/{path}/areas` — the world's maps and what is drawn inside them
 * (ADR-0004, G3).
 *
 * The room list is the index; the areas are the point. Personal desks, silent zones and meeting spots live inside
 * `.wam` files and are invisible anywhere outside the map editor, yet "who owns that desk" is exactly the question
 * an administrator arrives with.
 *
 * Read-only, and the only thing the dashboard shows that `admin-api` does not own: maps live in `map-storage`.
 * Editing one is the map editor's job, and a write here would be a second place that can change a map, with
 * different rules and a different audit story.
 */
export class AdminRoomsController {
    constructor(
        private readonly app: Express,
        /** Absent when `INTERNAL_MAP_STORAGE_URL` is unset: the screen then says so instead of guessing. */
        private readonly rooms: RoomCatalogue | undefined,
        /** Used to put a name to the email a personal area stores as its owner. */
        private readonly members: MemberRepository,
    ) {
        this.listRooms();
        this.listAreas();
    }

    /** The two answers that are not about a map at all: not configured, and somebody else's outage. */
    private handleFailure(res: Response, next: NextFunction, error: unknown, what: string): void {
        if (error instanceof RoomCatalogueUnavailable) {
            // 502, and said plainly: this is map-storage's outage, and naming it is what stops the next person from
            // looking for the bug in the dashboard.
            console.warn(`[${new Date().toISOString()}] The room catalogue is unavailable`, error);
            res.status(502).json({
                status: "error",
                type: "error",
                code: "ADMIN_ROOMS_UNAVAILABLE",
                title: "Rooms unavailable",
                subtitle: "",
                details: "map-storage could not be reached. The rest of the dashboard is unaffected.",
            });
            return;
        }

        console.error(`[${new Date().toISOString()}] Failed to ${what}`, error);
        next(error);
    }

    /** @returns the catalogue, or `undefined` after answering 501 itself. */
    private catalogueOr501(res: Response): RoomCatalogue | undefined {
        if (this.rooms === undefined) {
            // 501, not 500: nothing is broken, this deployment simply never told us where map-storage is.
            res.status(501).json({
                status: "error",
                type: "error",
                code: "ADMIN_ROOMS_NOT_CONFIGURED",
                title: "Rooms unavailable",
                subtitle: "",
                details: "INTERNAL_MAP_STORAGE_URL is not set, so the room catalogue cannot be read.",
            });
        }

        return this.rooms;
    }

    private listRooms(): void {
        this.app.get("/admin/api/rooms", (req: Request, res: Response, next: NextFunction) => {
            (async () => {
                const catalogue = this.catalogueOr501(res);

                if (catalogue !== undefined) {
                    res.status(200).json(await catalogue.listRooms());
                }
            })().catch((error: unknown) => this.handleFailure(res, next, error, "list rooms"));
        });
    }

    private listAreas(): void {
        // `{*path}` because a room path has slashes in it — `maps/tests/area.wam` is one room, not three segments.
        this.app.get("/admin/api/rooms/{*path}/areas", (req: Request, res: Response, next: NextFunction) => {
            (async () => {
                const catalogue = this.catalogueOr501(res);

                if (catalogue === undefined) {
                    return;
                }

                const raw = req.params.path;
                const path = Array.isArray(raw) ? raw.join("/") : (raw ?? "");

                const areas = await catalogue.listAreas(path);

                // Owners are emails in the map file; the screen wants people. Resolved here rather than in the
                // catalogue, which knows about map-storage and nothing else.
                res.status(200).json(await resolveAreaOwners(areas, this.members));
            })().catch((error: unknown) => this.handleFailure(res, next, error, "list areas"));
        });
    }
}

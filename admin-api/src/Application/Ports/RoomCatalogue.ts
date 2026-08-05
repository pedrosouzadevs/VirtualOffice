import type { Area, Room } from "../../Domain/Room";

/** Raised when `map-storage` could not be reached or did not answer something we understand. */
export class RoomCatalogueUnavailable extends Error {
    constructor(message: string, options?: { cause: unknown }) {
        super(message, options);
        this.name = "RoomCatalogueUnavailable";
    }
}

/**
 * The rooms the world contains.
 *
 * Declared here so the dependency points inward, and so the controller's tests never need a live `map-storage`. The
 * catalogue lives in another service entirely — this is the one thing the dashboard reads that `admin-api` does not
 * own, which is exactly why it gets an explicit "unavailable" failure rather than a generic one.
 */
export interface RoomCatalogue {
    /**
     * Every room, ordered by name.
     *
     * @throws {RoomCatalogueUnavailable} when `map-storage` is unreachable or answers something unparseable. The
     * caller turns that into a 502, because it is somebody else's outage and saying so is what stops the next person
     * from looking for the bug here.
     */
    listRooms(): Promise<Room[]>;

    /**
     * The areas drawn inside one map — personal desks, silent zones, meeting spots.
     *
     * @param path the room's path, as {@link Room.path} gives it.
     * @throws {RoomCatalogueUnavailable} when the map cannot be read or is not a map file we understand.
     */
    listAreas(path: string): Promise<Area[]>;
}

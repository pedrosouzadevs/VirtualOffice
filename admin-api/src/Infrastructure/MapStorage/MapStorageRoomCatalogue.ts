import { z } from "zod";
import { RoomCatalogueUnavailable, type RoomCatalogue } from "../../Application/Ports/RoomCatalogue";
import type { Area, Room } from "../../Domain/Room";

/**
 * `map-storage` is inside the network and answers from a file it already has on disk; a slow answer means it is
 * wedged, not busy. Short enough that the dashboard degrades quickly rather than hanging on somebody else's problem.
 */
const REQUEST_TIMEOUT_MS = 5_000;

/**
 * What we read out of `/maps`.
 *
 * A **narrow, permissive** schema rather than `MapsCacheFileFormat` from `@workadventure/map-editor`, and that is a
 * deliberate departure from this package's usual rule of never retyping a contract.
 *
 * The rule exists because a wrong field on `/api/map` breaks login — we *answer* that contract and must match it
 * exactly. Here we merely *read* another service's output, and the blast radius of being wrong is a room shown by its
 * path instead of its friendly name. Importing the schema would pull seven dependencies and the whole map-editing
 * domain into the service that owns identity, to validate three display fields.
 *
 * Everything below the two we need is optional and unknown keys are ignored, so `map-storage` adding to its answer
 * can never break this screen.
 */
const MapsResponse = z.object({
    maps: z.record(
        z.string(),
        z.object({
            mapUrl: z.string().optional(),
            metadata: z
                .object({
                    name: z.string().optional(),
                    description: z.string().optional(),
                    thumbnail: z.string().optional(),
                    // Read but shown nowhere in the dashboard: `/api/room/sameWorld` answers the whole of
                    // `WAMMetadata`, and `LocalAdmin` — the implementation it replaces — spreads every field.
                    copyright: z.string().optional(),
                    areasSearchable: z.number().optional(),
                    entitiesSearchable: z.number().optional(),
                })
                .optional(),
        }),
    ),
});

/** The property that makes an area someone's own. Matches `PersonalAreaPropertyData` in `@workadventure/map-editor`. */
const PERSONAL_AREA_PROPERTY = "personalAreaPropertyData";

/**
 * What we read out of a `.wam` file.
 *
 * Narrow and permissive for the same reason as {@link MapsResponse}: the map editor gains properties over time, and a
 * screen that breaks because a map carries a property this version has not heard of would be useless exactly when
 * somebody upgrades. Every property keeps its unknown keys, so the ones we do read are read from the real thing.
 */
const WamFile = z.object({
    areas: z
        .array(
            z.object({
                id: z.string(),
                name: z.string().default(""),
                // `passthrough` keeps the fields each property type carries — `ownerId` and friends — which the
                // discriminated union in `@workadventure/map-editor` would otherwise be needed to describe.
                properties: z.array(z.object({ type: z.string() }).passthrough()).default([]),
            }),
        )
        .default([]),
});

/** Joins the public base and the map path without producing a double slash or losing a path segment. */
function toWamUrl(publicMapStorageUrl: string, path: string): string {
    const base = publicMapStorageUrl.endsWith("/") ? publicMapStorageUrl : `${publicMapStorageUrl}/`;

    try {
        return new URL(path, base).toString();
    } catch {
        // A base that is not a URL is a misconfiguration, not a reason to fail the whole listing. The path alone is
        // still a true statement about where the map lives.
        return path;
    }
}

/**
 * Turns the `/maps` payload into rooms.
 *
 * Exported and pure so the mapping — which is the part with rules in it — is testable without a network.
 */
export function toRooms(payload: unknown, publicMapStorageUrl: string): Room[] {
    const parsed = MapsResponse.safeParse(payload);

    if (!parsed.success) {
        throw new RoomCatalogueUnavailable("map-storage answered something this version does not understand.");
    }

    return Object.entries(parsed.data.maps)
        .map(([path, map]) => ({
            path,
            // The same shape `LocalAdmin.getUrlRoomsFromSameWorld` builds, so a link from here matches how `play`
            // addresses the room.
            roomUrl: `/~/${path}`,
            wamUrl: toWamUrl(publicMapStorageUrl, path),
            name: map.metadata?.name ?? path,
            description: map.metadata?.description,
            thumbnail: map.metadata?.thumbnail,
            copyright: map.metadata?.copyright,
            areasSearchable: map.metadata?.areasSearchable,
            entitiesSearchable: map.metadata?.entitiesSearchable,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/** Reads a string field off a passthrough property without trusting that it is there or that it is a string. */
function readString(property: Record<string, unknown>, key: string): string | undefined {
    const value = property[key];

    return typeof value === "string" ? value : undefined;
}

/**
 * Turns a `.wam` file into the areas an administrator asks about.
 *
 * Exported and pure: this is where the rules are — which property makes an area personal, what to do with an
 * unclaimed one — and none of them need a network to test.
 *
 * Owners come back as the raw email the map stores. Putting a name to it needs the member repository, which belongs
 * to a different source entirely; `resolveAreaOwners` in the Application layer does that.
 */
export function toAreas(payload: unknown): Area[] {
    const parsed = WamFile.safeParse(payload);

    if (!parsed.success) {
        throw new RoomCatalogueUnavailable("map-storage answered a map file this version does not understand.");
    }

    return parsed.data.areas.map((area) => {
        const personalProperty = area.properties.find((property) => property.type === PERSONAL_AREA_PROPERTY);

        return {
            id: area.id,
            name: area.name,
            kinds: area.properties.map((property) => property.type),
            personal:
                personalProperty === undefined
                    ? undefined
                    : (() => {
                          const ownerId = readString(personalProperty, "ownerId") ?? null;
                          const allowed = personalProperty.allowedTags;

                          return {
                              ownerId,
                              // Left unresolved here; `resolveAreaOwners` fills these in.
                              ownerName: null,
                              ownerUnknown: false,
                              allowedTags: Array.isArray(allowed)
                                  ? allowed.filter((tag): tag is string => typeof tag === "string")
                                  : [],
                              accessClaimMode: readString(personalProperty, "accessClaimMode"),
                          };
                      })(),
        };
    });
}

/**
 * Reads the room list from `map-storage` over HTTP.
 *
 * `GET /maps` there is **unauthenticated** — `LocalAdmin` calls it with no header at all — so there is no token to
 * configure. Worth knowing rather than assuming: the room list is readable by anything on the Docker network, which
 * is map-storage's decision and not one this service can tighten. What the dashboard adds is that *its* copy sits
 * behind the session barrier like everything else under `/admin`.
 */
export class MapStorageRoomCatalogue implements RoomCatalogue {
    constructor(
        private readonly internalMapStorageUrl: string,
        private readonly publicMapStorageUrl: string,
    ) {}

    public async listRooms(): Promise<Room[]> {
        return toRooms(await this.get("maps"), this.publicMapStorageUrl);
    }

    public async listAreas(path: string): Promise<Area[]> {
        // The path comes from our own room list, but it reaches us through a URL, so it is caller-controlled by the
        // time it gets here. Anything that could climb out of the map tree is refused rather than forwarded.
        if (path.includes("..") || path.startsWith("/")) {
            throw new RoomCatalogueUnavailable(`"${path}" is not a room path.`);
        }

        return toAreas(await this.get(path));
    }

    /** One place where map-storage is talked to, so every failure gets the same answer. */
    private async get(path: string): Promise<unknown> {
        const base = this.internalMapStorageUrl.replace(/\/+$/, "");

        try {
            const response = await fetch(`${base}/${path}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

            if (!response.ok) {
                throw new RoomCatalogueUnavailable(`map-storage answered ${response.status} for /${path}.`);
            }

            return await response.json();
        } catch (error: unknown) {
            if (error instanceof RoomCatalogueUnavailable) {
                throw error;
            }

            // Connection refused, DNS failure, timeout, a body that is not JSON: all the same answer to the caller,
            // which is "not our outage, try again".
            throw new RoomCatalogueUnavailable("map-storage could not be reached.", { cause: error });
        }
    }
}

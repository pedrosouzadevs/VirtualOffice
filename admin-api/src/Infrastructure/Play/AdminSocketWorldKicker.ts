import { SignJWT } from "jose";
import type { RoomCatalogue } from "../../Application/Ports/RoomCatalogue";
import type { WorldKicker } from "../../Application/Ports/WorldKicker";

/**
 * Generous for an in-network hop, short enough that a wedged pusher degrades the dashboard's answer to
 * `kicked: false` instead of hanging the request. The ban itself landed before this timer ever starts.
 */
const KICK_TIMEOUT_MS = 5_000;

/**
 * How long the socket stays open after the last message, listening for an `Error` frame.
 *
 * The pusher answers nothing on success — only on failure — so silence is the success signal, and the only way to
 * read silence is to wait a moment for its opposite.
 */
const ERROR_GRACE_MS = 300;

export interface KickMessage {
    readonly event: "user-message";
    readonly jwt: string;
    /** The pusher filters rooms with `roomId.split("/")[5] === world`; see {@link groupRoomIdsByWorld}. */
    readonly world: string;
    readonly message: {
        /** `"banned"` is the branch that reaches `emitBan` — `"ban"` merely sends a warning text. */
        readonly type: "banned";
        readonly message: string;
        readonly userUuid: string;
    };
}

/**
 * Builds the full room IDs the pusher knows, from the catalogue's in-world paths.
 *
 * A pusher `roomId` is the URL the browser connected with — `http://play.example.com/~/maps/office.wam` — so the
 * public play origin is the missing half. Exported and pure for the tests pinning ADR-0006's mandatory test #7.
 */
export function toRoomIds(roomUrls: readonly string[], playUrl: string): string[] {
    const base = playUrl.replace(/\/+$/, "");

    return roomUrls.map((roomUrl) => `${base}${roomUrl.startsWith("/") ? "" : "/"}${roomUrl}`);
}

/**
 * Groups room IDs by the value the pusher's admin socket calls `world`.
 *
 * `IoSocketController` filters with `roomId.split("/")[5] === message.world`. For `/@/team/world/room` URLs — the
 * SaaS shape the filter was written for — that is the world slug; for our `/~/maps/x.wam` rooms it lands on the
 * **map file name**, so two maps in one folder are two "worlds" to this filter and get one message each. A room
 * whose URL is too short to have a sixth segment (`/~/x.wam`) can never match and is dropped rather than sent.
 *
 * It is the pusher's contract, quirk included; deriving anything cleverer here would be retyping a contract by hand
 * (ADR-0006, decision #3).
 */
export function groupRoomIdsByWorld(roomIds: readonly string[]): Map<string, string[]> {
    const groups = new Map<string, string[]>();

    for (const roomId of roomIds) {
        const world = roomId.split("/")[5];

        if (world === undefined || world === "") {
            // A URL too short to have a sixth segment can never match the pusher's filter; sending it would be
            // asking for a kick in no room at all.
            continue;
        }

        groups.set(world, [...(groups.get(world) ?? []), roomId]);
    }

    return groups;
}

/** The JWT the pusher's `verifyAdminSocketToken` accepts: HS256 over the shared token, listing the rooms. */
export async function signAdminSocketJwt(adminSocketsToken: string, authorizedRoomIds: string[]): Promise<string> {
    return (
        new SignJWT({ authorizedRoomIds })
            .setProtectedHeader({ alg: "HS256" })
            .setIssuedAt()
            // One minute: the token crosses one in-network hop and is verified immediately. Anything longer is
            // replay surface with no compensating convenience.
            .setExpirationTime("1m")
            .sign(new TextEncoder().encode(adminSocketsToken))
    );
}

/** Builds every message one kick sends — pure, so the shape is testable without a socket. */
export async function buildKickMessages(
    adminSocketsToken: string,
    roomIds: readonly string[],
    identifier: string,
    message: string,
): Promise<KickMessage[]> {
    const jwt = await signAdminSocketJwt(adminSocketsToken, [...roomIds]);

    return [...groupRoomIdsByWorld(roomIds).keys()].map((world) => ({
        event: "user-message",
        jwt,
        world,
        message: { type: "banned", message, userUuid: identifier },
    }));
}

export interface AdminSocketConfiguration {
    /** The shared secret that both mounts the pusher's endpoint and signs our JWT. */
    readonly adminSocketsToken: string;
    /** In-network address of the pusher's websocket app, e.g. `http://play:3001`. `http(s)` is rewritten to `ws(s)`. */
    readonly internalPlayUrl: string;
    /** Public world origin, e.g. `http://play.workadventure.localhost` — what room IDs start with. */
    readonly playUrl: string;
}

/**
 * The kick, over the pusher's own `/ws/admin/rooms` websocket (ADR-0006, decision #3).
 *
 * The channel was built for exactly this — its `"banned"` branch calls the same `emitBan` an in-world ban uses —
 * and sat dormant because nothing ever set `ADMIN_SOCKETS_TOKEN`. Node's global WebSocket (22+) carries the
 * conversation; no client dependency needed.
 *
 * Every failure path answers `false` rather than throwing: by the time this runs the ban is recorded and the door
 * is closed, and a monitoring-grade courtesy must never look like a failed moderation action.
 */
export class AdminSocketWorldKicker implements WorldKicker {
    constructor(
        private readonly configuration: AdminSocketConfiguration,
        /** The same catalogue the dashboard and `/api/room/sameWorld` read: map-storage stays read in one place. */
        private readonly rooms: RoomCatalogue,
    ) {}

    public async kick(identifier: string, message: string): Promise<boolean> {
        try {
            const roomUrls = (await this.rooms.listRooms()).map((room) => room.roomUrl);
            const roomIds = toRoomIds(roomUrls, this.configuration.playUrl);
            const messages = await buildKickMessages(
                this.configuration.adminSocketsToken,
                roomIds,
                identifier,
                message,
            );

            if (messages.length === 0) {
                // No rooms, nobody to kick out of anywhere. The ban record and the door still stand.
                return false;
            }

            return await this.deliver(messages);
        } catch (error: unknown) {
            console.warn(`[${new Date().toISOString()}] The kick could not be delivered`, error);

            return false;
        }
    }

    /** Opens the socket, sends every message, and reads silence as success (the pusher only answers on failure). */
    private deliver(messages: readonly KickMessage[]): Promise<boolean> {
        const url = new URL("/ws/admin/rooms", this.configuration.internalPlayUrl.replace(/^http/, "ws"));

        return new Promise<boolean>((resolve) => {
            const socket = new WebSocket(url);
            let failed = false;

            const finish = (delivered: boolean): void => {
                clearTimeout(deadline);
                resolve(delivered && !failed);
                try {
                    socket.close();
                } catch {
                    // Already closed; the answer stands either way.
                }
            };

            const deadline = setTimeout(() => finish(false), KICK_TIMEOUT_MS);

            socket.addEventListener("open", () => {
                for (const message of messages) {
                    socket.send(JSON.stringify(message));
                }

                // Silence is the success signal; give the pusher a moment to contradict it.
                setTimeout(() => finish(true), ERROR_GRACE_MS);
            });

            socket.addEventListener("message", (event) => {
                // Anything the pusher says here is a refusal — bad token, unparseable message.
                console.warn(`[${new Date().toISOString()}] The pusher refused the kick: ${String(event.data)}`);
                failed = true;
                finish(false);
            });

            socket.addEventListener("error", () => finish(false));
        });
    }
}

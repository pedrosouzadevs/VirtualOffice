import type {
    ApplicationDefinitionInterface,
    CompanionDetail,
    ErrorApiErrorData,
    WokaDetail,
} from "@workadventure/messages";
import type { BanRecord } from "../Domain/Ban";
import { MAP_EDITOR_TAGS, type Member } from "../Domain/Member";

/** One integration the world offers, e.g. Klaxoon or tldraw. */
export interface ApplicationFlag {
    name: string;
    doc: string | undefined;
    image: string | undefined;
    description: string;
    enabled: boolean;
}

export interface RoomAccessConfiguration {
    /** Global kill switch. When the map editor is off, no tag can turn `canEdit` on. */
    enableMapEditor: boolean;
    /** Returned verbatim in the `world` field. Fixed in P0 (ADR-0002, decision #7). */
    worldName: string;
    /** Whether the LiveKit S3 target is fully configured. */
    recordingConfigured: boolean;
    /** Applications enabled for this world, already filtered. */
    applications: readonly ApplicationDefinitionInterface[];
}

export interface RoomAccessRequest {
    /** What the pusher calls the user: an email when logged in, a uuid when anonymous. */
    userIdentifier: string;
    playUri: string;
    accessToken: string | undefined;
}

export interface ResolvedTextures {
    characterTextures: WokaDetail[] | undefined;
    companionTextureRequested: boolean;
    companionTexture: CompanionDetail | undefined;
}

/**
 * Whether the member may open the map editor in this room.
 *
 * Two conditions, both from `LocalAdmin.fetchMemberDataByUuid`: the room must live in map-storage (only `/~/` rooms
 * are editable) and the map editor must be enabled globally.
 *
 * The third condition is where this service earns its keep. `LocalAdmin` also accepts `MAP_EDITOR_ALLOW_ALL_USERS`
 * and `MAP_EDITOR_ALLOWED_USERS`; **we deliberately do not**. Honouring them would defeat the whole point of the
 * feature — the pusher stops sending OIDC tags the moment `ADMIN_API_URL` is set, so authorisation is ours alone now
 * and it must come from the database, not from an environment variable nobody can change through a screen.
 */
export function canEditMap(playUri: string, tags: readonly string[], enableMapEditor: boolean): boolean {
    if (!enableMapEditor) {
        return false;
    }

    let pathname: string;
    try {
        pathname = new URL(playUri).pathname;
    } catch {
        return false;
    }

    if (!/\/~\/(.+)/.exec(pathname)) {
        return false;
    }

    return MAP_EDITOR_TAGS.some((tag) => tags.includes(tag));
}

/**
 * The answer for somebody a ban keeps out (ADR-0006, decision #2).
 *
 * `/api/room/access` is the one endpoint the pusher calls on **every** connection and on login, so answering the
 * error variant of its response union here is what makes a ban survive reconnection — with no `play` change and no
 * caller for `verifyBanUser` needed.
 *
 * Shaped as `ErrorApiErrorData` and answered with **HTTP 200**: the pusher's axios throws on any non-2xx and
 * substitutes a generic "Connection error", which would cost the banned person the message an administrator wrote
 * for them. `type: "error"` is terminal — the front shows its error screen and stops; `"retry"` would put the
 * banned person in a polite reconnection loop against a door that will not open.
 */
export function buildBannedRoomAccess(ban: BanRecord): ErrorApiErrorData {
    return {
        status: "error",
        type: "error",
        // The same code the front's own hardcoded ban screen uses, so logs and screenshots read consistently
        // whichever path refused the person.
        code: "USER_BANNED",
        title: "BANNED",
        subtitle: ban.message.trim() === "" ? "You have been banned from this world." : ban.message,
        details: "If you believe this is a mistake, contact an administrator.",
    };
}

/**
 * Builds the `/api/room/access` payload.
 *
 * Faithful port of `LocalAdmin.fetchMemberDataByUuid`, with two substitutions: `tags` come from our database instead
 * of the OIDC claim, and `canEdit` is derived from those tags.
 *
 * `userUuid` echoes the `userIdentifier` the pusher sent rather than our internal `member.id`, and that is not an
 * oversight. The front stores this value as its local user uuid, and the map editor writes it into
 * `personalAreaPropertyData.ownerId` when someone claims a personal area. Returning our internal id instead would
 * orphan every personal area already claimed — it would break F4, which is already shipped. ADR-0002 decision #5
 * says the same thing from the other direction: the internal primary key is never an external identifier.
 *
 * @param member the member we know, or `undefined` for someone we have never seen. An unknown visitor gets in with no
 * tags — never an error, otherwise nobody new could ever enter the world.
 */
export function buildRoomAccess(
    request: RoomAccessRequest,
    member: Member | undefined,
    textures: ResolvedTextures,
    config: RoomAccessConfiguration,
) {
    const tags = member?.tags ?? [];

    return {
        status: "ok" as const,
        // The member's stored email when we know them; otherwise whatever the pusher called them, which is what
        // LocalAdmin returns. For anonymous users that is a uuid, and the schema allows it.
        email: member?.email ?? request.userIdentifier,
        userUuid: request.userIdentifier,
        username: member?.username ?? undefined,
        tags: [...tags],
        visitCardUrl: null,
        isCharacterTexturesValid: textures.characterTextures !== undefined,
        characterTextures: textures.characterTextures ?? [],
        isCompanionTextureValid: !textures.companionTextureRequested || textures.companionTexture !== undefined,
        companionTexture: textures.companionTexture,
        messages: [],
        userRoomToken: undefined,
        activatedInviteUser: true,
        applications: [...config.applications],
        canEdit: canEditMap(request.playUri, tags, config.enableMapEditor),
        world: config.worldName,
        canRecord: config.recordingConfigured && request.accessToken !== undefined,
    };
}

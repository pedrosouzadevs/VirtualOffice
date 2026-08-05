import path from "node:path";
import {
    OpidWokaNamePolicy,
    type ErrorApiData,
    type MapDetailsData,
    type RequiredMetaTagsData,
    type RoomRedirect,
} from "@workadventure/messages";

/**
 * Everything `/api/map` needs, passed in rather than read from the environment.
 *
 * Keeping this a plain value makes the builder a pure function: same input, same payload, no I/O — which is what lets
 * the contract tests cover every branch without a running server or a prepared environment.
 */
export interface MapDetailsConfiguration {
    startRoomUrl: string;
    publicMapStorageUrl: string;
    disableAnonymous: boolean;
    enableChat: boolean;
    enableChatUpload: boolean;
    enableChatOnlineList: boolean;
    enableChatDisconnectedList: boolean;
    enableSay: boolean;
    enableIssueReport: boolean;
    enableTutorial: boolean;
    skipCameraPage: boolean;
    bypassPwa: boolean;
    defaultWokaName: string | undefined;
    defaultWokaTexture: string | undefined;
    provideDefaultWokaName: "no" | "random" | "fix" | "fix-plus-random-numbers" | undefined;
    provideDefaultWokaTexture: "no" | "random" | "fix" | undefined;
    opidWokaNamePolicy: string;
    matrixChatConfigured: boolean;
    recordingConfigured: boolean;
}

/**
 * Copied verbatim from `play/src/pusher/services/MetaTagsBuilder.ts`. These are hardcoded constants there, not
 * configuration, so there is nothing to read from the environment — but they must stay identical, otherwise browser
 * tab titles and social cards change the day the Admin API is switched on.
 */
const META_TAGS_DEFAULT_VALUE: RequiredMetaTagsData = {
    title: "ArqueumSpace",
    description:
        "Organize your online event in ArqueumSpace to recreate spontaneous social interactions. Connect, collaborate and have fun with your teammates and attendees.",
    author: "ArqueumSpace team",
    provider: "ArqueumSpace",
    favIcons: [
        {
            rel: "icon",
            sizes: "512x512",
            src: "/static/images/favicons/favicon-512x512.svg",
        },
    ],
    manifestIcons: [
        {
            src: "/static/images/favicons/icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
        },
    ],
    appName: "ArqueumSpace",
    shortAppName: "WA",
    themeColor: "#1B2A41",
    cardImage: "https://workadventu.re/images/general/logo-og.png",
};

/**
 * Resolves a room URL into the map details `play` needs, a redirect, or a typed error.
 *
 * Faithful port of `LocalAdmin.fetchMapDetails`, which is the behaviour P0 must preserve exactly. Three fields that
 * function returns are deliberately **not** reproduced, because `isMapDetailsData` has no such keys and `zod` drops
 * them on arrival:
 *
 * - `canEdit` — the map editor is unlocked by `/api/room/access`, whose value reaches the front through the protobuf
 *   `RoomJoinedMessage` (`RoomConnection.ts:565`). On `/api/map` it is dead weight.
 * - `loadingCowebsiteLogo` — no such field in the schema.
 * - `opidUsernamePolicy` — an upstream typo for `opidWokaNamePolicy`. We emit the **correct** name. This is safe
 *   rather than a behaviour change because the front already falls back to its own environment variable when the
 *   field is absent (`Room.ts:183`, `data.opidWokaNamePolicy ?? OPID_WOKA_NAME_POLICY`), and both sides read the
 *   same value.
 */
export function buildMapDetails(
    playUri: string,
    config: MapDetailsConfiguration,
): MapDetailsData | RoomRedirect | ErrorApiData {
    const roomUrl = new URL(playUri);

    if (roomUrl.pathname === "/") {
        roomUrl.pathname = config.startRoomUrl;
        return { redirectUrl: roomUrl.toString() };
    }

    let mapUrl: string | undefined = undefined;
    let wamUrl: string | undefined = undefined;

    let match = /\/~\/(.+)/.exec(roomUrl.pathname);
    if (match) {
        if (path.extname(roomUrl.pathname) === ".tmj") {
            // Tiled maps served from map-storage are addressed through their .wam wrapper. Note this replaces the
            // first ".tmj" anywhere in the URL, matching LocalAdmin; a room whose name contains ".tmj" would be
            // rewritten oddly, but diverging here would be a behaviour change, not a fix.
            return { redirectUrl: roomUrl.toString().replace(".tmj", ".wam") };
        }
        wamUrl = `${config.publicMapStorageUrl}/${match[1] ?? ""}`;
    } else {
        match = /\/_\/[^/]+\/(.+)/.exec(roomUrl.pathname);
        if (!match) {
            return {
                status: "error",
                type: "error",
                code: "UNSUPPORTED_URL_FORMAT",
                title: "Unsupported URL format",
                subtitle: "",
                details: "Unsupported path: " + roomUrl.pathname,
                image: undefined,
            };
        }
        mapUrl = roomUrl.protocol + "//" + (match[1] ?? "");
    }

    const opidWokaNamePolicyCheck = OpidWokaNamePolicy.safeParse(config.opidWokaNamePolicy);

    return {
        mapUrl,
        wamUrl,
        authenticationMandatory: config.disableAnonymous,
        contactPage: null,
        // "default" for map-storage rooms, null otherwise — this is the world grouping, and the only field the
        // schema actually requires.
        group: wamUrl ? "default" : null,
        opidLogoutRedirectUrl: null,
        opidWokaNamePolicy: opidWokaNamePolicyCheck.success ? opidWokaNamePolicyCheck.data : null,
        loadingLogo: null,
        loginSceneLogo: null,
        errorSceneLogo: null,
        showPoweredBy: true,
        enableChat: config.enableChat,
        enableChatUpload: config.enableChatUpload,
        enableChatOnlineList: config.enableChatOnlineList,
        enableChatDisconnectedList: config.enableChatDisconnectedList,
        enableSay: config.enableSay,
        enableIssueReport: config.enableIssueReport,
        enableMatrixChat: config.matrixChatConfigured,
        defaultWokaName: config.defaultWokaName,
        defaultWokaTexture: config.defaultWokaTexture,
        skipCameraPage: config.skipCameraPage,
        bypassPwa: config.bypassPwa,
        provideDefaultWokaName: config.provideDefaultWokaName,
        provideDefaultWokaTexture: config.provideDefaultWokaTexture,
        metatags: {
            ...META_TAGS_DEFAULT_VALUE,
        },
        recording: {
            buttonState: config.recordingConfigured ? "enabled" : "hidden",
            disabledReason: null,
        },
        metadata: {
            enableTutorial: config.enableTutorial,
        },
    };
}

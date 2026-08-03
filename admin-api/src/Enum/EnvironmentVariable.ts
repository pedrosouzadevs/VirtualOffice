import { EnvironmentVariables } from "./EnvironmentVariableValidator";

const envChecking = EnvironmentVariables.safeParse(process.env);

// Will break the process if an error happens
if (!envChecking.success) {
    console.error("\n\n\n-----------------------------------------");
    console.error("FATAL ERRORS FOUND IN ENVIRONMENT VARIABLES!!!");
    console.error("-----------------------------------------\n");

    const formattedError = envChecking.error.format();

    for (const [name, value] of Object.entries(formattedError)) {
        if (Array.isArray(value)) {
            continue;
        }

        for (const error of value._errors) {
            console.error(`For variable "${name}": ${error}`);
        }
    }

    console.error("\n-----------------------------------------\n\n\n");

    process.exit(1);
}

const env = envChecking.data;

export const ADMIN_API_PORT = env.ADMIN_API_PORT;
export const ADMIN_API_TOKEN = env.ADMIN_API_TOKEN;
export const ADMIN_API_DATABASE_URL = env.ADMIN_API_DATABASE_URL;
export const ADMIN_API_BOOTSTRAP_ADMIN_EMAIL = env.ADMIN_API_BOOTSTRAP_ADMIN_EMAIL;

// --- Admin dashboard (ADR-0004) ------------------------------------------------------------------------------------

export const ADMIN_API_PUBLIC_URL = env.ADMIN_API_PUBLIC_URL;
export const ADMIN_API_SESSION_SECRET = env.ADMIN_API_SESSION_SECRET;

/**
 * Normalised for `app.set("trust proxy", …)`, which treats a boolean, a hop count and an address list differently.
 * Passing the raw string through would make `"false"` a truthy address list rather than a way to switch it off.
 */
export const ADMIN_API_TRUST_PROXY: boolean | number | string = (() => {
    const raw = env.ADMIN_API_TRUST_PROXY;

    if (raw.toLowerCase() === "true") {
        return true;
    }

    if (raw.toLowerCase() === "false") {
        return false;
    }

    return /^\d+$/.test(raw) ? Number(raw) : raw;
})();

// Same order the pusher resolves these in, so a single `.env` configures both sides identically.
export const OPID_CLIENT_ID = env.OPENID_CLIENT_ID ?? env.OPID_CLIENT_ID;
export const OPID_CLIENT_SECRET = env.OPENID_CLIENT_SECRET ?? env.OPID_CLIENT_SECRET;
export const OPID_CLIENT_ISSUER = env.OPENID_CLIENT_ISSUER ?? env.OPID_CLIENT_ISSUER;

/** `openid` and `email` are what the dashboard actually needs: the email is the key our members are stored under. */
export const OPID_SCOPE = env.OPENID_SCOPE ?? env.OPID_SCOPE ?? "openid email profile";
export const OPID_PROMPT = env.OPENID_PROMPT ?? env.OPID_PROMPT;

export const START_ROOM_URL = env.START_ROOM_URL;
export const PUBLIC_MAP_STORAGE_URL = env.PUBLIC_MAP_STORAGE_URL;
export const INTERNAL_MAP_STORAGE_URL = env.INTERNAL_MAP_STORAGE_URL;
export const ADMIN_API_ALERT_WEBHOOK_URL = env.ADMIN_API_ALERT_WEBHOOK_URL;

export const DISABLE_ANONYMOUS = env.DISABLE_ANONYMOUS;
export const ENABLE_CHAT = env.ENABLE_CHAT;
export const ENABLE_CHAT_UPLOAD = env.ENABLE_CHAT_UPLOAD;
export const ENABLE_CHAT_ONLINE_LIST = env.ENABLE_CHAT_ONLINE_LIST;
export const ENABLE_CHAT_DISCONNECTED_LIST = env.ENABLE_CHAT_DISCONNECTED_LIST;
export const ENABLE_SAY = env.ENABLE_SAY;
export const ENABLE_ISSUE_REPORT = env.ENABLE_ISSUE_REPORT;
export const ENABLE_TUTORIAL = env.ENABLE_TUTORIAL;
export const SKIP_CAMERA_PAGE = env.SKIP_CAMERA_PAGE;
export const BYPASS_PWA = env.BYPASS_PWA;

export const DEFAULT_WOKA_NAME = env.DEFAULT_WOKA_NAME;
export const DEFAULT_WOKA_TEXTURE = env.DEFAULT_WOKA_TEXTURE;
export const PROVIDE_DEFAULT_WOKA_NAME = env.PROVIDE_DEFAULT_WOKA_NAME;
export const PROVIDE_DEFAULT_WOKA_TEXTURE = env.PROVIDE_DEFAULT_WOKA_TEXTURE;

/** Mirrors the pusher: the deprecated variable first, then the current one, then the `user_input` default. */
export const OPID_WOKA_NAME_POLICY = env.OPENID_WOKA_NAME_POLICY ?? env.OPID_WOKA_NAME_POLICY ?? "user_input";

export const MATRIX_PUBLIC_URI = env.MATRIX_PUBLIC_URI;
export const MATRIX_API_URI = env.MATRIX_API_URI;
export const MATRIX_ADMIN_USER = env.MATRIX_ADMIN_USER;
export const MATRIX_ADMIN_PASSWORD = env.MATRIX_ADMIN_PASSWORD;
export const MATRIX_DOMAIN = env.MATRIX_DOMAIN;

export const ENABLE_MAP_EDITOR = env.ENABLE_MAP_EDITOR;
export const ADMIN_API_WORLD_NAME = env.ADMIN_API_WORLD_NAME;

export const KLAXOON_ENABLED = env.KLAXOON_ENABLED;
export const YOUTUBE_ENABLED = env.YOUTUBE_ENABLED;
export const GOOGLE_DRIVE_ENABLED = env.GOOGLE_DRIVE_ENABLED;
export const GOOGLE_DOCS_ENABLED = env.GOOGLE_DOCS_ENABLED;
export const GOOGLE_SHEETS_ENABLED = env.GOOGLE_SHEETS_ENABLED;
export const GOOGLE_SLIDES_ENABLED = env.GOOGLE_SLIDES_ENABLED;
export const ERASER_ENABLED = env.ERASER_ENABLED;
export const EXCALIDRAW_ENABLED = env.EXCALIDRAW_ENABLED;
export const CARDS_ENABLED = env.CARDS_ENABLED;
export const TLDRAW_ENABLED = env.TLDRAW_ENABLED;

export const LIVEKIT_RECORDING_S3_ENDPOINT = env.LIVEKIT_RECORDING_S3_ENDPOINT;
export const LIVEKIT_RECORDING_S3_BUCKET = env.LIVEKIT_RECORDING_S3_BUCKET;
export const LIVEKIT_RECORDING_S3_ACCESS_KEY = env.LIVEKIT_RECORDING_S3_ACCESS_KEY;
export const LIVEKIT_RECORDING_S3_SECRET_KEY = env.LIVEKIT_RECORDING_S3_SECRET_KEY;
export const LIVEKIT_RECORDING_S3_REGION = env.LIVEKIT_RECORDING_S3_REGION;

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

export const START_ROOM_URL = env.START_ROOM_URL;
export const PUBLIC_MAP_STORAGE_URL = env.PUBLIC_MAP_STORAGE_URL;

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

export const LIVEKIT_RECORDING_S3_ENDPOINT = env.LIVEKIT_RECORDING_S3_ENDPOINT;
export const LIVEKIT_RECORDING_S3_BUCKET = env.LIVEKIT_RECORDING_S3_BUCKET;
export const LIVEKIT_RECORDING_S3_ACCESS_KEY = env.LIVEKIT_RECORDING_S3_ACCESS_KEY;
export const LIVEKIT_RECORDING_S3_SECRET_KEY = env.LIVEKIT_RECORDING_S3_SECRET_KEY;
export const LIVEKIT_RECORDING_S3_REGION = env.LIVEKIT_RECORDING_S3_REGION;

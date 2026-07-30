import {
    ADMIN_API_PORT,
    ADMIN_API_TOKEN,
    BYPASS_PWA,
    DEFAULT_WOKA_NAME,
    DEFAULT_WOKA_TEXTURE,
    DISABLE_ANONYMOUS,
    ENABLE_CHAT,
    ENABLE_CHAT_DISCONNECTED_LIST,
    ENABLE_CHAT_ONLINE_LIST,
    ENABLE_CHAT_UPLOAD,
    ENABLE_ISSUE_REPORT,
    ENABLE_SAY,
    ENABLE_TUTORIAL,
    LIVEKIT_RECORDING_S3_ACCESS_KEY,
    LIVEKIT_RECORDING_S3_BUCKET,
    LIVEKIT_RECORDING_S3_ENDPOINT,
    LIVEKIT_RECORDING_S3_REGION,
    LIVEKIT_RECORDING_S3_SECRET_KEY,
    MATRIX_ADMIN_PASSWORD,
    MATRIX_ADMIN_USER,
    MATRIX_API_URI,
    MATRIX_DOMAIN,
    MATRIX_PUBLIC_URI,
    OPID_WOKA_NAME_POLICY,
    PROVIDE_DEFAULT_WOKA_NAME,
    PROVIDE_DEFAULT_WOKA_TEXTURE,
    PUBLIC_MAP_STORAGE_URL,
    SKIP_CAMERA_PAGE,
    START_ROOM_URL,
} from "./Enum/EnvironmentVariable";
import type { MapDetailsConfiguration } from "./Application/MapDetailsService";
import { createServer } from "./api/server";

/**
 * Both flags follow LocalAdmin: the feature is on only when its whole configuration is present, never partially.
 */
const matrixChatConfigured = Boolean(
    MATRIX_PUBLIC_URI && MATRIX_API_URI && MATRIX_ADMIN_USER && MATRIX_ADMIN_PASSWORD && MATRIX_DOMAIN,
);
const recordingConfigured = Boolean(
    LIVEKIT_RECORDING_S3_ENDPOINT &&
    LIVEKIT_RECORDING_S3_BUCKET &&
    LIVEKIT_RECORDING_S3_ACCESS_KEY &&
    LIVEKIT_RECORDING_S3_SECRET_KEY &&
    LIVEKIT_RECORDING_S3_REGION,
);

const mapDetailsConfiguration: MapDetailsConfiguration = {
    startRoomUrl: START_ROOM_URL,
    publicMapStorageUrl: PUBLIC_MAP_STORAGE_URL,
    disableAnonymous: DISABLE_ANONYMOUS,
    enableChat: ENABLE_CHAT,
    enableChatUpload: ENABLE_CHAT_UPLOAD,
    enableChatOnlineList: ENABLE_CHAT_ONLINE_LIST,
    enableChatDisconnectedList: ENABLE_CHAT_DISCONNECTED_LIST,
    enableSay: ENABLE_SAY,
    enableIssueReport: ENABLE_ISSUE_REPORT,
    enableTutorial: ENABLE_TUTORIAL,
    skipCameraPage: SKIP_CAMERA_PAGE,
    bypassPwa: BYPASS_PWA,
    defaultWokaName: DEFAULT_WOKA_NAME,
    defaultWokaTexture: DEFAULT_WOKA_TEXTURE,
    provideDefaultWokaName: PROVIDE_DEFAULT_WOKA_NAME,
    provideDefaultWokaTexture: PROVIDE_DEFAULT_WOKA_TEXTURE,
    opidWokaNamePolicy: OPID_WOKA_NAME_POLICY,
    matrixChatConfigured,
    recordingConfigured,
};

const app = createServer({ adminApiToken: ADMIN_API_TOKEN, mapDetailsConfiguration });

app.listen(ADMIN_API_PORT, () => {
    console.info(`VirtualOffice admin-api listening on port ${ADMIN_API_PORT}`);
});

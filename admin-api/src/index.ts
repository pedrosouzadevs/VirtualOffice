import {
    ADMIN_API_BOOTSTRAP_ADMIN_EMAIL,
    ADMIN_API_DATABASE_URL,
    ADMIN_API_PORT,
    ADMIN_API_TOKEN,
    ADMIN_API_WORLD_NAME,
    BYPASS_PWA,
    CARDS_ENABLED,
    ENABLE_MAP_EDITOR,
    ERASER_ENABLED,
    EXCALIDRAW_ENABLED,
    GOOGLE_DOCS_ENABLED,
    GOOGLE_DRIVE_ENABLED,
    GOOGLE_SHEETS_ENABLED,
    GOOGLE_SLIDES_ENABLED,
    KLAXOON_ENABLED,
    TLDRAW_ENABLED,
    YOUTUBE_ENABLED,
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
import { buildApplications } from "./Application/ApplicationsCatalogue";
import { bootstrapAdmin } from "./Application/BootstrapAdminService";
import type { MapDetailsConfiguration } from "./Application/MapDetailsService";
import { createDatabaseConnection } from "./Infrastructure/Database/connection";
import { runMigrations } from "./Infrastructure/Database/migrate";
import { PostgresReadinessCheck } from "./Infrastructure/Database/PostgresReadinessCheck";
import { DrizzleMemberRepository } from "./Infrastructure/Repositories/DrizzleMemberRepository";
import { DrizzleTagRepository } from "./Infrastructure/Repositories/DrizzleTagRepository";
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

/**
 * Migrate, bootstrap, then serve — in that order and before binding the port.
 *
 * Answering requests against a schema that has not been migrated would mean serving errors to the pusher, and the
 * pusher's retry loop turns our errors into a hung `play`. Failing to start is the safer failure.
 */
async function start(): Promise<void> {
    const connection = createDatabaseConnection(ADMIN_API_DATABASE_URL);

    await runMigrations(connection.db);

    const memberRepository = new DrizzleMemberRepository(connection.db);
    const tagRepository = new DrizzleTagRepository(connection.db);
    await bootstrapAdmin(memberRepository, ADMIN_API_BOOTSTRAP_ADMIN_EMAIL);

    const app = createServer({
        adminApiToken: ADMIN_API_TOKEN,
        mapDetailsConfiguration,
        roomAccessConfiguration: {
            enableMapEditor: ENABLE_MAP_EDITOR,
            worldName: ADMIN_API_WORLD_NAME,
            recordingConfigured,
            applications: buildApplications({
                klaxoon: KLAXOON_ENABLED,
                youtube: YOUTUBE_ENABLED,
                googleDrive: GOOGLE_DRIVE_ENABLED,
                googleDocs: GOOGLE_DOCS_ENABLED,
                googleSheets: GOOGLE_SHEETS_ENABLED,
                googleSlides: GOOGLE_SLIDES_ENABLED,
                eraser: ERASER_ENABLED,
                excalidraw: EXCALIDRAW_ENABLED,
                cards: CARDS_ENABLED,
                tldraw: TLDRAW_ENABLED,
            }),
        },
        memberRepository,
        tagRepository,
        readinessChecks: [new PostgresReadinessCheck(connection.sql)],
    });

    app.listen(ADMIN_API_PORT, () => {
        console.info(`VirtualOffice admin-api listening on port ${ADMIN_API_PORT}`);
    });
}

start().catch((error: unknown) => {
    console.error("admin-api failed to start.", error);
    process.exit(1);
});

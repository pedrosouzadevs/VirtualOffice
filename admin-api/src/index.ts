import {
    ADMIN_API_ALERT_WEBHOOK_URL,
    ADMIN_API_BOOTSTRAP_ADMIN_EMAIL,
    ADMIN_API_DATABASE_URL,
    ADMIN_API_PORT,
    ADMIN_API_PUBLIC_URL,
    ADMIN_API_SESSION_SECRET,
    ADMIN_API_TOKEN,
    ADMIN_API_TRUST_PROXY,
    ADMIN_API_WORLD_NAME,
    ADMIN_SOCKETS_TOKEN,
    INTERNAL_PLAY_URL,
    PLAY_URL,
    OPID_CLIENT_ID,
    OPID_CLIENT_ISSUER,
    OPID_CLIENT_SECRET,
    OPID_PROMPT,
    OPID_SCOPE,
    BYPASS_PWA,
    CARDS_ENABLED,
    ENABLE_MAP_EDITOR,
    ERASER_ENABLED,
    INTERNAL_MAP_STORAGE_URL,
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
import { resolveAdminDashboardConfiguration } from "./Application/AdminDashboardConfiguration";
import { buildApplications } from "./Application/ApplicationsCatalogue";
import { bootstrapAdmin } from "./Application/BootstrapAdminService";
import type { MapDetailsConfiguration } from "./Application/MapDetailsService";
import { LoggingAdminAlerter } from "./Infrastructure/Alerting/LoggingAdminAlerter";
import { MapStorageRoomCatalogue } from "./Infrastructure/MapStorage/MapStorageRoomCatalogue";
import { AdminSocketWorldKicker } from "./Infrastructure/Play/AdminSocketWorldKicker";
import { OpenIdConnectAuthenticator } from "./Infrastructure/Oidc/OpenIdConnectAuthenticator";
import { createDatabaseConnection } from "./Infrastructure/Database/connection";
import { runMigrations } from "./Infrastructure/Database/migrate";
import { PostgresReadinessCheck } from "./Infrastructure/Database/PostgresReadinessCheck";
import { DrizzleAuditLogRepository } from "./Infrastructure/Repositories/DrizzleAuditLogRepository";
import { DrizzleBanRepository } from "./Infrastructure/Repositories/DrizzleBanRepository";
import { DrizzleMemberRepository } from "./Infrastructure/Repositories/DrizzleMemberRepository";
import { DrizzleReportRepository } from "./Infrastructure/Repositories/DrizzleReportRepository";
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
 * The dashboard is a separate concern from the pusher-facing API, and stays that way when it is misconfigured.
 *
 * A missing or half-filled configuration disables `/admin/*` and is reported loudly here; it never stops the process.
 * Exiting would take `/api/*` down with it, and the pusher's uncapped retry loop turns that into a `play` that never
 * opens its port (ADR-0002, Trap #2).
 */
const dashboard = resolveAdminDashboardConfiguration({
    publicUrl: ADMIN_API_PUBLIC_URL,
    sessionSecret: ADMIN_API_SESSION_SECRET,
    issuer: OPID_CLIENT_ISSUER,
    clientId: OPID_CLIENT_ID,
    clientSecret: OPID_CLIENT_SECRET,
    scope: OPID_SCOPE,
    prompt: OPID_PROMPT,
});

if (!dashboard.enabled) {
    console.warn(
        `The administration dashboard is disabled: /admin/* will answer 503. Missing configuration: ${dashboard.missing.join(", ")}.`,
    );
}

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
    const banRepository = new DrizzleBanRepository(connection.db);
    const reportRepository = new DrizzleReportRepository(connection.db);
    const auditLog = new DrizzleAuditLogRepository(connection.db);
    const roomCatalogue =
        INTERNAL_MAP_STORAGE_URL === undefined
            ? undefined
            : new MapStorageRoomCatalogue(INTERNAL_MAP_STORAGE_URL, PUBLIC_MAP_STORAGE_URL);
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
        banRepository,
        reportRepository,
        auditLog,
        roomCatalogue,
        // The kick needs all four legs: the shared token (which is also what mounts the pusher's endpoint), both
        // play addresses, and the room catalogue. Any missing one degrades a dashboard ban to record-plus-door,
        // reported as kicked: false — never an error (ADR-0006, decision #3).
        worldKicker:
            ADMIN_SOCKETS_TOKEN !== undefined &&
            INTERNAL_PLAY_URL !== undefined &&
            PLAY_URL !== undefined &&
            roomCatalogue !== undefined
                ? new AdminSocketWorldKicker(
                      { adminSocketsToken: ADMIN_SOCKETS_TOKEN, internalPlayUrl: INTERNAL_PLAY_URL, playUrl: PLAY_URL },
                      roomCatalogue,
                  )
                : undefined,
        readinessChecks: [new PostgresReadinessCheck(connection.sql)],
        trustProxy: ADMIN_API_TRUST_PROXY,
        adminDashboard: dashboard.enabled
            ? {
                  configuration: dashboard.configuration,
                  authenticator: new OpenIdConnectAuthenticator(dashboard.configuration),
                  alerter: new LoggingAdminAlerter(ADMIN_API_ALERT_WEBHOOK_URL),
              }
            : undefined,
    });

    app.listen(ADMIN_API_PORT, () => {
        console.info(`VirtualOffice admin-api listening on port ${ADMIN_API_PORT}`);
    });
}

start().catch((error: unknown) => {
    console.error("admin-api failed to start.", error);
    process.exit(1);
});

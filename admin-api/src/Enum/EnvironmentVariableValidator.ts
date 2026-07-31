import { z } from "zod";

/**
 * Coerces a string environment variable into a number, keeping the default when the variable is absent or empty.
 *
 * Docker Compose interpolates an unset variable into an empty string rather than omitting it, so `z.coerce.number()`
 * alone would turn `""` into `0` and silently bind the server to a random port.
 */
const numberOrDefault = (defaultValue: number) =>
    z
        .string()
        .optional()
        .transform((value) => (value === undefined || value.trim() === "" ? defaultValue : Number(value)))
        .pipe(z.number().int().positive());

/**
 * Reads a `"true"`/`"false"` environment variable, falling back to `defaultValue` when unset or empty.
 *
 * Mirrors the pusher's `BoolAsString` + `toBool` pair so a given `.env` produces the same booleans on both sides.
 */
const boolOrDefault = (defaultValue: boolean) =>
    z
        .string()
        .optional()
        .transform((value) => {
            if (value === undefined || value.trim() === "") {
                return defaultValue;
            }
            return value.trim().toLowerCase() === "true";
        });

/** Reads a string variable, mapping an empty value to `undefined` rather than `""`. */
const optionalString = () =>
    z
        .string()
        .optional()
        .transform((value) => (value === undefined || value.trim() === "" ? undefined : value));

/**
 * Environment contract of `admin-api`.
 *
 * ⚠️ Every variable below is also read by `play` today. Once `ADMIN_API_URL` is set, `/api/map` is built from **our**
 * values and `play`'s copies stop applying to those fields (ADR-0002, "Important side effect"). Defaults here must
 * match `play/src/pusher/enums/EnvironmentVariableValidator.ts` exactly, otherwise turning the Admin API on silently
 * changes the world's configuration.
 */
export const EnvironmentVariables = z.object({
    /** Port the HTTP server listens on. */
    ADMIN_API_PORT: numberOrDefault(3000),

    /**
     * Shared secret the pusher sends in the `Authorization` header — raw, with no `Bearer` prefix.
     *
     * Must match `ADMIN_API_TOKEN` on the `play` side. Required: starting without it would leave the API either open
     * or permanently unreachable, and both are worse than failing loudly at boot.
     */
    ADMIN_API_TOKEN: z.string().min(1, "ADMIN_API_TOKEN is required and must not be empty"),

    /** Connection string for the Admin API's own Postgres. `admin-api`-only, hence the prefix. */
    ADMIN_API_DATABASE_URL: z.string().min(1, "ADMIN_API_DATABASE_URL is required and must not be empty"),

    /**
     * Email granted the `admin` tag by the idempotent bootstrap on every startup (ADR-0002, decision #6).
     *
     * Optional: with no value the tags are still created and the service starts, it simply has no administrator yet.
     * Refusing to boot would be worse — it would make a fresh environment unusable rather than merely unmanaged.
     */
    ADMIN_API_BOOTSTRAP_ADMIN_EMAIL: optionalString(),

    // --- Map routing ---------------------------------------------------------------------------------------------

    /** Where a request to `/` is redirected. Same default as the pusher. */
    START_ROOM_URL: z
        .string()
        .optional()
        .transform((value) =>
            value === undefined || value.trim() === "" ? "/_/global/maps.workadventu.re/starter/map.json" : value,
        ),

    /** Public base URL of map-storage, used to build `wamUrl` for `/~/` rooms. */
    PUBLIC_MAP_STORAGE_URL: z
        .string()
        .optional()
        .transform((value) => value ?? ""),

    // --- Map details payload -------------------------------------------------------------------------------------

    DISABLE_ANONYMOUS: boolOrDefault(false),
    ENABLE_CHAT: boolOrDefault(true),
    ENABLE_CHAT_UPLOAD: boolOrDefault(true),
    ENABLE_CHAT_ONLINE_LIST: boolOrDefault(true),
    ENABLE_CHAT_DISCONNECTED_LIST: boolOrDefault(true),
    ENABLE_SAY: boolOrDefault(true),
    ENABLE_ISSUE_REPORT: boolOrDefault(true),
    ENABLE_TUTORIAL: boolOrDefault(true),
    SKIP_CAMERA_PAGE: boolOrDefault(false),
    BYPASS_PWA: boolOrDefault(false),

    DEFAULT_WOKA_NAME: optionalString(),
    DEFAULT_WOKA_TEXTURE: optionalString(),

    PROVIDE_DEFAULT_WOKA_NAME: z
        .enum(["no", "random", "fix", "fix-plus-random-numbers", ""])
        .optional()
        .transform((value) => (value === "" ? undefined : value)),
    PROVIDE_DEFAULT_WOKA_TEXTURE: z
        .enum(["no", "random", "fix", ""])
        .optional()
        .transform((value) => (value === "" ? undefined : value)),

    /** Same fallback chain as the pusher: the deprecated name, then the current one, then `user_input`. */
    OPENID_WOKA_NAME_POLICY: optionalString(),
    OPID_WOKA_NAME_POLICY: optionalString(),

    // Matrix: `enableMatrixChat` is true only when all five are present, matching LocalAdmin.
    MATRIX_PUBLIC_URI: optionalString(),
    MATRIX_API_URI: optionalString(),
    MATRIX_ADMIN_USER: optionalString(),
    MATRIX_ADMIN_PASSWORD: optionalString(),
    MATRIX_DOMAIN: optionalString(),

    // --- Room access ---------------------------------------------------------------------------------------------

    /**
     * Global kill switch for the map editor. Still honoured: when the feature is off, no tag may turn `canEdit` on.
     *
     * Note that `MAP_EDITOR_ALLOW_ALL_USERS` and `MAP_EDITOR_ALLOWED_USERS` are deliberately **not** read here. The
     * pusher stops forwarding OIDC tags once `ADMIN_API_URL` is set, so authorisation is ours alone and must come
     * from the database — that is the whole point of the feature (ADR-0002).
     */
    ENABLE_MAP_EDITOR: boolOrDefault(true),

    /** Returned verbatim in the `world` field. Fixed in P0 (ADR-0002, decision #7). */
    ADMIN_API_WORLD_NAME: z
        .string()
        .optional()
        .transform((value) => (value === undefined || value.trim() === "" ? "localWorld" : value)),

    // Integrations. Each maps to one entry in the `applications` array of /api/room/access.
    KLAXOON_ENABLED: boolOrDefault(false),
    YOUTUBE_ENABLED: boolOrDefault(false),
    GOOGLE_DRIVE_ENABLED: boolOrDefault(false),
    GOOGLE_DOCS_ENABLED: boolOrDefault(false),
    GOOGLE_SHEETS_ENABLED: boolOrDefault(false),
    GOOGLE_SLIDES_ENABLED: boolOrDefault(false),
    ERASER_ENABLED: boolOrDefault(false),
    EXCALIDRAW_ENABLED: boolOrDefault(false),
    CARDS_ENABLED: boolOrDefault(false),
    TLDRAW_ENABLED: boolOrDefault(false),

    // Recording: the button is shown only when the whole S3 target is configured, matching LocalAdmin.
    LIVEKIT_RECORDING_S3_ENDPOINT: optionalString(),
    LIVEKIT_RECORDING_S3_BUCKET: optionalString(),
    LIVEKIT_RECORDING_S3_ACCESS_KEY: optionalString(),
    LIVEKIT_RECORDING_S3_SECRET_KEY: optionalString(),
    LIVEKIT_RECORDING_S3_REGION: optionalString(),
});

export type EnvironmentVariables = z.infer<typeof EnvironmentVariables>;

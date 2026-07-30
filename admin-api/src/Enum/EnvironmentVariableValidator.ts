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
});

export type EnvironmentVariables = z.infer<typeof EnvironmentVariables>;

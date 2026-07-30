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
});

export type EnvironmentVariables = z.infer<typeof EnvironmentVariables>;

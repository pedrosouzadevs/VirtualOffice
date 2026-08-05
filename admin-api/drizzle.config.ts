import { defineConfig } from "drizzle-kit";

/**
 * Configuration for `drizzle-kit generate`, which turns `schema.ts` into SQL under `drizzle/`.
 *
 * Generated migrations are committed and **forward-only**: correcting a mistake means adding a migration, never
 * editing or reverting one that has already run somewhere.
 */
export default defineConfig({
    schema: "./src/Infrastructure/Database/schema.ts",
    out: "./drizzle",
    dialect: "postgresql",
    dbCredentials: {
        // Only read by the commands that talk to a live database (push, studio). `generate` works offline.
        url: process.env.ADMIN_API_DATABASE_URL ?? "postgres://localhost:5432/admin_api",
    },
});

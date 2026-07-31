import { defineConfig } from "vitest/config";

/**
 * Integration tests, which need a live Postgres reachable at `ADMIN_API_DATABASE_URL`.
 *
 * Kept in a separate config, and a separate command, so `npm test` stays runnable with no infrastructure. Tests here
 * talk to a real database on purpose: an in-memory stand-in would not catch the SQL-level behaviour these cover —
 * unique constraints, `ON CONFLICT DO NOTHING`, cascade deletes.
 *
 * Runs single-threaded: the suites share one database and truncate between tests.
 */
export default defineConfig({
    test: {
        include: ["tests/integration/**/*.test.ts"],
        fileParallelism: false,
        // Migrations on a cold database are slower than a unit test's default budget.
        testTimeout: 30_000,
        hookTimeout: 60_000,
    },
});

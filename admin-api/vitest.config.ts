import { defineConfig } from "vitest/config";

/**
 * Unit and contract tests: no external dependency, runnable anywhere.
 *
 * `tests/integration` is excluded because it needs a live Postgres; run it with `npm run test:integration`.
 */
export default defineConfig({
    test: {
        include: ["tests/**/*.test.ts"],
        exclude: ["tests/integration/**"],
        coverage: {
            include: ["src/*.ts", "src/**/*.ts"],
        },
    },
});

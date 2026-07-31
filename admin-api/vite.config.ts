import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

/**
 * Build for the administration dashboard's UI (ADR-0004, G2).
 *
 * Follows `map-storage/vite.config.ts`, the precedent the ADR names, with one difference that matters: `base` is
 * fixed at `/admin/` rather than driven by an environment variable. The path is not a deployment choice here — it is
 * the mount point of the session barrier, and the two cannot be allowed to disagree.
 */
export default defineConfig({
    base: "/admin/",
    build: {
        sourcemap: true,
        outDir: "./dist-ui",
        // The server serves this directory only when it exists, so a stale build is worse than none: it would show
        // yesterday's screen against today's API.
        emptyOutDir: true,
    },
    plugins: [svelte({ preprocess: vitePreprocess() })],
});

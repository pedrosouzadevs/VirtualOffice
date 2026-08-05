import type { ArqueumSpaceLocalAppApi } from "@wa-preload-local-app";

declare global {
    interface Window {
        WAD: ArqueumSpaceLocalAppApi;
    }
}

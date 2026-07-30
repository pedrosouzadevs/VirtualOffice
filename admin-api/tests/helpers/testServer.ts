import type { AddressInfo } from "node:net";
import type { Express } from "express";

export interface TestServer {
    /** Base URL of the listening server, e.g. `http://127.0.0.1:54321`. */
    readonly url: string;
    close(): Promise<void>;
}

/**
 * Starts an Express app on an ephemeral port so tests can exercise it over real HTTP.
 *
 * Port `0` lets the OS pick a free one, which keeps test files parallel-safe. We drive the API with the global `fetch`
 * rather than a request-injection library: the pusher reaches us over the wire, so the tests should too — and it keeps
 * the dependency list at zero for this.
 */
export async function startTestServer(app: Express): Promise<TestServer> {
    const server = await new Promise<ReturnType<Express["listen"]>>((resolve, reject) => {
        const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
        listening.on("error", reject);
    });

    const address = server.address() as AddressInfo;

    return {
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
            new Promise<void>((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
            }),
    };
}

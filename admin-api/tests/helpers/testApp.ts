import type { Express } from "express";
import { createServer, type ServerDependencies } from "../../src/api/server";
import { startTestServer, type TestServer } from "./testServer";

/** Any non-empty value works; tests assert on matching versus not matching, never on the value itself. */
export const TEST_ADMIN_API_TOKEN = "test-admin-api-token";

/**
 * Servers started by the current test file, torn down by {@link closeStartedServers}.
 *
 * Tracked in an array rather than a reassigned variable so a test may start more than one, and so teardown never
 * reassigns shared state across an `await` boundary.
 */
const started: TestServer[] = [];

/**
 * Builds the real application with test defaults and serves it on an ephemeral port.
 *
 * @returns the base URL of the running server.
 */
export async function serveTestApp(overrides: Partial<ServerDependencies> = {}): Promise<string> {
    const app: Express = createServer({ adminApiToken: TEST_ADMIN_API_TOKEN, ...overrides });
    const server = await startTestServer(app);
    started.push(server);

    return server.url;
}

export async function closeStartedServers(): Promise<void> {
    await Promise.all(started.splice(0).map((server) => server.close()));
}

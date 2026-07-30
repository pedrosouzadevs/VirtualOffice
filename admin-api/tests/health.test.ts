import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../src/api/server";
import type { ReadinessCheck } from "../src/api/controllers/HealthController";
import { startTestServer, type TestServer } from "./helpers/testServer";

const healthy = (name: string): ReadinessCheck => ({ name, check: () => Promise.resolve() });
const failing = (name: string, message: string): ReadinessCheck => ({
    name,
    check: () => Promise.reject(new Error(message)),
});

describe("HealthController", () => {
    let server: TestServer | undefined;

    afterEach(async () => {
        await server?.close();
        server = undefined;
    });

    describe("/healthz", () => {
        it("answers 200 even when a dependency is down, because liveness must not consult dependencies", async () => {
            server = await startTestServer(createServer({ readinessChecks: [failing("postgres", "refused")] }));

            const response = await fetch(`${server.url}/healthz`);

            expect(response.status).toBe(200);
            expect(await response.json()).toMatchObject({ status: "ok", service: "admin-api" });
        });
    });

    describe("/readyz", () => {
        it("answers 200 with no subsystem registered", async () => {
            server = await startTestServer(createServer());

            const response = await fetch(`${server.url}/readyz`);

            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ status: "ok", service: "admin-api", checks: {} });
        });

        it("answers 200 and names every healthy subsystem", async () => {
            server = await startTestServer(createServer({ readinessChecks: [healthy("postgres")] }));

            const response = await fetch(`${server.url}/readyz`);

            expect(response.status).toBe(200);
            expect(await response.json()).toMatchObject({ checks: { postgres: { status: "ok", detail: null } } });
        });

        it("answers 503 and reports the reason when a subsystem is down", async () => {
            server = await startTestServer(
                createServer({ readinessChecks: [healthy("healthy"), failing("postgres", "connection refused")] }),
            );

            const response = await fetch(`${server.url}/readyz`);

            expect(response.status).toBe(503);
            expect(await response.json()).toEqual({
                status: "error",
                service: "admin-api",
                checks: {
                    healthy: { status: "ok", detail: null },
                    postgres: { status: "error", detail: "connection refused" },
                },
            });
        });
    });
});

import { afterEach, describe, expect, it } from "vitest";
import type { ReadinessCheck } from "../src/api/controllers/HealthController";
import { closeStartedServers, serveTestApp } from "./helpers/testApp";

const healthy = (name: string): ReadinessCheck => ({ name, check: () => Promise.resolve() });
const failing = (name: string, message: string): ReadinessCheck => ({
    name,
    check: () => Promise.reject(new Error(message)),
});

afterEach(closeStartedServers);

describe("HealthController", () => {
    describe("/healthz", () => {
        it("answers 200 even when a dependency is down, because liveness must not consult dependencies", async () => {
            const url = await serveTestApp({ readinessChecks: [failing("postgres", "refused")] });

            const response = await fetch(`${url}/healthz`);

            expect(response.status).toBe(200);
            expect(await response.json()).toMatchObject({ status: "ok", service: "admin-api" });
        });

        it("is reachable without a token: it sits outside the /api mount the guard protects", async () => {
            const url = await serveTestApp();

            const response = await fetch(`${url}/healthz`);

            expect(response.status).toBe(200);
        });
    });

    describe("/readyz", () => {
        it("answers 200 with no subsystem registered", async () => {
            const url = await serveTestApp();

            const response = await fetch(`${url}/readyz`);

            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ status: "ok", service: "admin-api", checks: {} });
        });

        it("answers 200 and names every healthy subsystem", async () => {
            const url = await serveTestApp({ readinessChecks: [healthy("postgres")] });

            const response = await fetch(`${url}/readyz`);

            expect(response.status).toBe(200);
            expect(await response.json()).toMatchObject({ checks: { postgres: { status: "ok", detail: null } } });
        });

        it("answers 503 and reports the reason when a subsystem is down", async () => {
            const url = await serveTestApp({
                readinessChecks: [healthy("healthy"), failing("postgres", "connection refused")],
            });

            const response = await fetch(`${url}/readyz`);

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

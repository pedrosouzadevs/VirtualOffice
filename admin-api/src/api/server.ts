import express, { type Express } from "express";
import { HealthController, type ReadinessCheck } from "./controllers/HealthController";

export interface ServerDependencies {
    /** Subsystem probes consulted by `/readyz`. Empty until Postgres lands (ADR-0002, P0/E4). */
    readinessChecks?: readonly ReadinessCheck[];
}

/**
 * Builds the Express application without listening on a port.
 *
 * Keeping construction separate from binding is what lets the contract tests drive the real app through supertest
 * instead of booting a server and racing on its port.
 */
export function createServer(dependencies: ServerDependencies = {}): Express {
    const app = express();

    // The pusher only ever issues GETs and small JSON POSTs against this API; there is no reason to accept a large body.
    app.use(express.json({ limit: "100kb" }));

    new HealthController(app, dependencies.readinessChecks ?? []);

    return app;
}

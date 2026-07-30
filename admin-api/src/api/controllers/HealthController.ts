import type { Express, Request, Response } from "express";

/**
 * A named probe for a subsystem `admin-api` depends on (Postgres, and later anything else).
 *
 * Registered probes are only consulted by the readiness endpoint: liveness must stay dependency-free, otherwise a
 * transient Postgres outage would make the orchestrator kill an otherwise healthy process.
 */
export interface ReadinessCheck {
    readonly name: string;

    /**
     * Resolves when the subsystem is usable, rejects otherwise. The rejection message is surfaced in the response body.
     */
    check(): Promise<void>;
}

interface SubsystemStatus {
    status: "ok" | "error";
    detail: string | null;
}

/**
 * Liveness (`/healthz`) and readiness (`/readyz`) endpoints.
 *
 * Both answer JSON describing each subsystem rather than a bare status code, so an operator can tell *what* is broken
 * straight from the probe output.
 */
export class HealthController {
    constructor(
        private readonly app: Express,
        private readonly checks: readonly ReadinessCheck[] = [],
    ) {
        this.getHealthz();
        this.getReadyz();
    }

    /**
     * Liveness: is the process running? Never touches a dependency.
     */
    private getHealthz(): void {
        this.app.get("/healthz", (req: Request, res: Response) => {
            res.status(200).json({
                status: "ok",
                service: "admin-api",
                uptime: process.uptime(),
            });
        });
    }

    /**
     * Readiness: can the process serve traffic right now? Consults every registered subsystem.
     */
    private getReadyz(): void {
        this.app.get("/readyz", (req: Request, res: Response) => {
            void (async () => {
                const subsystems: Record<string, SubsystemStatus> = {};

                const results = await Promise.all(
                    this.checks.map(async (readinessCheck): Promise<[string, SubsystemStatus]> => {
                        try {
                            await readinessCheck.check();
                            return [readinessCheck.name, { status: "ok", detail: null }];
                        } catch (error) {
                            return [
                                readinessCheck.name,
                                { status: "error", detail: error instanceof Error ? error.message : "Unknown error" },
                            ];
                        }
                    }),
                );

                for (const [name, status] of results) {
                    subsystems[name] = status;
                }

                const ready = results.every(([, status]) => status.status === "ok");

                res.status(ready ? 200 : 503).json({
                    status: ready ? "ok" : "error",
                    service: "admin-api",
                    checks: subsystems,
                });
            })();
        });
    }
}

import type postgres from "postgres";
import type { ReadinessCheck } from "../../api/controllers/HealthController";

/**
 * Readiness probe for the Admin API's Postgres.
 *
 * Deliberately registered on `/readyz` only. Liveness must stay dependency-free: if a Postgres blip made `/healthz`
 * fail, the orchestrator would restart a process that is perfectly healthy and would come back just as unable to
 * reach the database.
 */
export class PostgresReadinessCheck implements ReadinessCheck {
    readonly name = "postgres";

    constructor(private readonly sql: postgres.Sql) {}

    async check(): Promise<void> {
        await this.sql`select 1`;
    }
}

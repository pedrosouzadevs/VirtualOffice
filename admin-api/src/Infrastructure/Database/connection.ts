import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

export interface DatabaseConnection {
    /** Query builder used by the repositories. */
    readonly db: Database;
    /** Raw client, for the readiness probe and for migrations. */
    readonly sql: postgres.Sql;
    close(): Promise<void>;
}

/**
 * Opens a pooled connection to the Admin API's own Postgres.
 *
 * `max` is deliberately small: this service answers a handful of endpoints per user session, and an oversized pool
 * only moves the queue from the application into the database.
 */
export function createDatabaseConnection(databaseUrl: string, maxConnections = 10): DatabaseConnection {
    const sql = postgres(databaseUrl, {
        max: maxConnections,
        // postgres.js prints NOTICE messages to stderr by default, which floods the log during migrations.
        onnotice: () => {},
    });

    return {
        db: drizzle(sql, { schema }),
        sql,
        close: () => sql.end(),
    };
}

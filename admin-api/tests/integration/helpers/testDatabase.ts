import postgres from "postgres";
import { createDatabaseConnection, type DatabaseConnection } from "../../../src/Infrastructure/Database/connection";
import { runMigrations } from "../../../src/Infrastructure/Database/migrate";

/**
 * Connection string for the integration suite.
 *
 * Derived from `ADMIN_API_DATABASE_URL` by appending `_test` to the database name, so running the suite can never
 * truncate the development data sitting in the main database. Override with `ADMIN_API_TEST_DATABASE_URL` if you
 * need to point somewhere else.
 */
function resolveTestDatabaseUrl(): { url: URL; databaseName: string; maintenanceUrl: URL } {
    const override = process.env.ADMIN_API_TEST_DATABASE_URL;
    const base = process.env.ADMIN_API_DATABASE_URL;

    if (override === undefined && base === undefined) {
        throw new Error(
            "Integration tests need ADMIN_API_DATABASE_URL (or ADMIN_API_TEST_DATABASE_URL). Start the admin-api-db service and run them through docker compose.",
        );
    }

    const url = new URL(override ?? (base as string));
    if (override === undefined) {
        url.pathname = `${url.pathname}_test`;
    }

    const databaseName = url.pathname.replace(/^\//, "");

    // "postgres" is the maintenance database every server ships with; we connect there only to CREATE DATABASE.
    const maintenanceUrl = new URL(url.toString());
    maintenanceUrl.pathname = "/postgres";

    return { url, databaseName, maintenanceUrl };
}

/**
 * Ensures the test database exists, migrates it, and hands back a connection.
 *
 * Postgres has no `CREATE DATABASE IF NOT EXISTS`, hence the explicit catalogue check.
 */
export async function setupTestDatabase(): Promise<DatabaseConnection> {
    const { url, databaseName, maintenanceUrl } = resolveTestDatabaseUrl();

    const maintenance = postgres(maintenanceUrl.toString(), { max: 1, onnotice: () => {} });
    try {
        const existing = await maintenance`select 1 from pg_database where datname = ${databaseName}`;
        if (existing.length === 0) {
            // The identifier cannot be parameterised, so it is escaped explicitly. databaseName is derived from our
            // own configuration, never from user input.
            await maintenance.unsafe(`CREATE DATABASE "${databaseName.replace(/"/g, '""')}"`);
        }
    } finally {
        await maintenance.end();
    }

    const connection = createDatabaseConnection(url.toString(), 5);
    await runMigrations(connection.db);

    return connection;
}

/** Empties every table between tests. CASCADE handles member_tag's foreign keys. */
export async function truncateAll(connection: DatabaseConnection): Promise<void> {
    // `audit_log` is listed explicitly because nothing references it — the cascade from the other tables would not
    // reach it, and a test asserting "one entry was written" would see everything the previous test wrote too.
    await connection.sql`truncate table "member_tag", "member", "tag", "audit_log" cascade`;
}

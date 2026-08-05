import { ADMIN_API_DATABASE_URL } from "../../Enum/EnvironmentVariable";
import { createDatabaseConnection } from "./connection";
import { runMigrations } from "./migrate";

/**
 * Standalone entry point for `npm run db:migrate`.
 *
 * The server also migrates on startup, so this exists for the cases where that is not what you want: running
 * migrations before a deploy, or preparing a test database.
 */
async function main(): Promise<void> {
    const connection = createDatabaseConnection(ADMIN_API_DATABASE_URL, 1);

    try {
        await runMigrations(connection.db);
        console.info("Migrations applied.");
    } catch (error) {
        console.error("Migrations failed.", error);
        process.exitCode = 1;
    } finally {
        await connection.close();
    }
}

main().catch((error: unknown) => {
    console.error("Migration runner crashed.", error);
    process.exit(1);
});

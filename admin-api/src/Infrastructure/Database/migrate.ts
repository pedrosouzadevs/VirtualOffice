import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Database } from "./connection";

/** Where `drizzle-kit generate` writes the SQL. Resolved from this file so the CWD does not matter. */
const MIGRATIONS_FOLDER = new URL("../../../drizzle", import.meta.url).pathname;

/**
 * Applies every pending migration.
 *
 * Migrations are **forward-only**: a mistake is corrected by a new migration, never by editing or rolling back an
 * applied one. Drizzle records what it has run in its own table and takes a Postgres advisory lock while it works, so
 * two instances starting at once cannot apply the same migration twice.
 */
export async function runMigrations(db: Database): Promise<void> {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

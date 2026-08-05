import { desc, eq } from "drizzle-orm";
import type { BanRepository } from "../../Application/Ports/BanRepository";
import type { BanRecord, NewBan } from "../../Domain/Ban";
import { normalizeIdentifier } from "../../Domain/Member";
import type { Database } from "../Database/connection";
import { ban } from "../Database/schema";

/** The shape a row comes back as, before it is narrowed to the domain type. */
interface BanRow {
    id: string;
    identifier: string;
    displayName: string | null;
    message: string;
    roomUrl: string;
    issuedBy: string;
    createdAt: Date;
}

function toRecord(row: BanRow): BanRecord {
    return {
        id: row.id,
        identifier: row.identifier,
        displayName: row.displayName,
        message: row.message,
        roomUrl: row.roomUrl,
        issuedBy: row.issuedBy,
        createdAt: row.createdAt,
    };
}

export class DrizzleBanRepository implements BanRepository {
    constructor(private readonly db: Database) {}

    async record(entry: NewBan): Promise<BanRecord> {
        const [row] = await this.db
            .insert(ban)
            .values({
                // Normalised on the way in, like every other identifier here, so the lookup finds it again.
                identifier: normalizeIdentifier(entry.identifier),
                displayName: entry.displayName,
                message: entry.message,
                roomUrl: entry.roomUrl,
                issuedBy: normalizeIdentifier(entry.issuedBy),
            })
            .returning();

        if (row === undefined) {
            // Postgres cannot insert nothing and return no row; this is unreachable and is here so the caller gets a
            // real object rather than a type assertion pretending it does.
            throw new Error("The ban was not written.");
        }

        return toRecord(row);
    }

    async findActive(identifier: string): Promise<BanRecord | undefined> {
        const rows = await this.db
            .select()
            .from(ban)
            .where(eq(ban.identifier, normalizeIdentifier(identifier)))
            // Newest first: somebody banned twice should be shown the message they were last given.
            .orderBy(desc(ban.createdAt))
            .limit(1);

        const row = rows[0];

        return row === undefined ? undefined : toRecord(row);
    }

    async listRecent(limit: number): Promise<BanRecord[]> {
        const rows = await this.db.select().from(ban).orderBy(desc(ban.createdAt)).limit(limit);

        return rows.map(toRecord);
    }
}

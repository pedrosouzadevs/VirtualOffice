import { asc, ilike } from "drizzle-orm";
import type { TagRepository } from "../../Application/Ports/TagRepository";
import type { Database } from "../Database/connection";
import { tag } from "../Database/schema";

export class DrizzleTagRepository implements TagRepository {
    constructor(private readonly db: Database) {}

    async search(searchText: string, limit: number): Promise<string[]> {
        const trimmed = searchText.trim();

        // `%` and `_` are LIKE wildcards, and `\` escapes them. Escaping the backslash first matters: doing it last
        // would re-escape the backslashes introduced by the other two replacements.
        const pattern = `%${trimmed.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;

        const rows = await this.db
            .select({ name: tag.name })
            .from(tag)
            .where(trimmed === "" ? undefined : ilike(tag.name, pattern))
            .orderBy(asc(tag.name))
            .limit(limit);

        return rows.map((row) => row.name);
    }

    async listAll(): Promise<string[]> {
        const rows = await this.db.select({ name: tag.name }).from(tag).orderBy(asc(tag.name));

        return rows.map((row) => row.name);
    }
}

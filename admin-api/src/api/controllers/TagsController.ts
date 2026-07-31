import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { TagRepository } from "../../Application/Ports/TagRepository";

/** The pickers show every option; the catalogue is small, so this only guards against pathological growth. */
const TAG_RESULT_LIMIT = 100;

const WorldTagsQuery = z.object({
    searchText: z.string().optional(),
    // Sent by the pusher. Ignored while there is a single world (ADR-0002, decision #7).
    playUri: z.string().optional(),
});

/**
 * `GET /api/world/tags` and `GET /api/room/tags`.
 *
 * `/api/world/tags` feeds `InputRoomTags`, which is the tag picker inside the lockable-area, personal-area and
 * area-rights editors — the pickers F4 relies on to gate an area by tag.
 *
 * Both answer a plain `string[]`. `AdminApi.searchTags` does **not** validate what it receives and
 * `handleSearchTagsQuery` does not catch, so a malformed answer from us would surface as an unhandled error in the
 * editor. `getTagsList` is gentler — `handleRoomTagsQuery` swallows failures into an empty list — which is worse in
 * its own way: a broken response there is invisible. We answer a well-formed array in both cases and let the empty
 * list mean what it says.
 */
export class TagsController {
    constructor(
        private readonly app: Express,
        private readonly tags: TagRepository,
    ) {
        this.getWorldTags();
        this.getRoomTags();
    }

    private getWorldTags(): void {
        this.app.get("/api/world/tags", (req: Request, res: Response, next: NextFunction) => {
            (async () => {
                const query = WorldTagsQuery.safeParse(req.query);

                if (!query.success) {
                    res.status(400).json({
                        status: "error",
                        type: "error",
                        code: "INVALID_TAG_SEARCH_QUERY",
                        title: "Invalid request",
                        subtitle: "",
                        details: "searchText must be a string.",
                    });
                    return;
                }

                res.status(200).json(await this.tags.search(query.data.searchText ?? "", TAG_RESULT_LIMIT));
            })().catch((error: unknown) => {
                console.error(`[${new Date().toISOString()}] Failed to search tags`, error);
                next(error);
            });
        });
    }

    private getRoomTags(): void {
        this.app.get("/api/room/tags", (req: Request, res: Response, next: NextFunction) => {
            (async () => {
                // Upstream describes this as "tags used somewhere in the room". With a single world and no room
                // model, every tag we know is in scope; this narrows when rooms are modelled.
                res.status(200).json(await this.tags.listAll());
            })().catch((error: unknown) => {
                console.error(`[${new Date().toISOString()}] Failed to list room tags`, error);
                next(error);
            });
        });
    }
}

import type { Express, NextFunction, Request, Response } from "express";
import type { TagRepository } from "../../Application/Ports/TagRepository";

/**
 * `GET /admin/api/tags` — the tag catalogue behind the dashboard's picker.
 *
 * Unfiltered and unpaginated on purpose: the catalogue is small and curated, and a picker that opens with every
 * option is what stops the free-text field from quietly creating `Admin` alongside `admin`.
 *
 * Read-only. Tags come into existence by being granted (ADR-0003), so there is nothing to create here, and deleting
 * one would silently strip it from everyone holding it — a mutation that deserves its own design, not a DELETE route
 * added because the noun had one.
 */
export class AdminTagsController {
    constructor(
        private readonly app: Express,
        private readonly tags: TagRepository,
    ) {
        this.listTags();
    }

    private listTags(): void {
        this.app.get("/admin/api/tags", (req: Request, res: Response, next: NextFunction) => {
            this.tags
                .listAll()
                .then((names) => {
                    res.status(200).json(names);
                })
                .catch((error: unknown) => {
                    console.error(`[${new Date().toISOString()}] Failed to list tags for the dashboard`, error);
                    next(error);
                });
        });
    }
}

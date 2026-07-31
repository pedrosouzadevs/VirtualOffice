import type { Express, NextFunction, Request, Response } from "express";
import type { CompanionCatalogue } from "../../Application/CompanionCatalogue";

/**
 * `GET /api/companion/list` — the world's companion catalogue.
 *
 * Implemented for the same reason as `/api/woka/list`: `/api/room/access` has to resolve `companionTextureId` against
 * a catalogue, and serving the list from a different copy than the one we validate against would bounce users back
 * to companion selection with no way through.
 */
export class CompanionListController {
    constructor(
        private readonly app: Express,
        private readonly catalogue: CompanionCatalogue,
    ) {
        this.getCompanionList();
    }

    private getCompanionList(): void {
        this.app.get("/api/companion/list", (req: Request, res: Response, next: NextFunction) => {
            this.catalogue
                .getCompanionList()
                .then((list) => {
                    res.status(200).json(list);
                })
                .catch((error: unknown) => {
                    console.error(`[${new Date().toISOString()}] Failed to serve the companion list`, error);
                    next(error);
                });
        });
    }
}

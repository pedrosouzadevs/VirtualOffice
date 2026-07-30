import type { Express, NextFunction, Request, Response } from "express";
import type { WokaCatalogue } from "../../Application/WokaCatalogue";

/**
 * `GET /api/woka/list` — the world's avatar catalogue.
 *
 * Only reached when `/api/capabilities` declares `"api/woka/list": "v1"`; otherwise the pusher serves its own local
 * catalogue (`WokaService.get`). We implement it so that the list users pick from and the catalogue
 * `/api/room/access` validates against are the same file (ADR-0002, Trap #3).
 *
 * The pusher passes `roomUrl` and `uuid`. Both are ignored in P0: there is one world and every Woka is available to
 * everyone. They become meaningful when per-world or per-tag catalogues arrive.
 */
export class WokaListController {
    constructor(
        private readonly app: Express,
        private readonly catalogue: WokaCatalogue,
    ) {
        this.getWokaList();
    }

    private getWokaList(): void {
        this.app.get("/api/woka/list", (req: Request, res: Response, next: NextFunction) => {
            this.catalogue
                .getWokaList()
                .then((list) => {
                    res.status(200).json(list);
                })
                .catch((error: unknown) => {
                    console.error(`[${new Date().toISOString()}] Failed to serve the Woka list`, error);
                    next(error);
                });
        });
    }
}

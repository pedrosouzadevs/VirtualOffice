import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { toMemberData } from "../../Application/MemberDataMapper";
import type { MemberRepository } from "../../Application/Ports/MemberRepository";

/**
 * The picker renders every result, so an unbounded answer would be both a slow query and an unusable dropdown.
 */
const SEARCH_RESULT_LIMIT = 20;

const SearchQuery = z.object({
    searchText: z.string().optional(),
    // Sent by the pusher. Ignored while there is a single world (ADR-0002, decision #7); it becomes the scope filter
    // when worlds arrive.
    playUri: z.string().optional(),
});

/**
 * `GET /api/members` and `GET /api/members/{id}`.
 *
 * Feeds the map editor's member picker — `MemberAutocomplete` → `PersonalAreaPropertyEditor` — which is what lets an
 * administrator *assign* ownership of a personal area instead of waiting for someone to claim it.
 *
 * The `{id}` segment is an **email**, whatever its name in the upstream OpenAPI comment suggests: the front calls
 * `queryMember(property.ownerId)`, and `ownerId` holds whatever we returned as `MemberData.id`.
 */
export class MembersController {
    constructor(
        private readonly app: Express,
        private readonly members: MemberRepository,
    ) {
        this.searchMembers();
        this.getMember();
    }

    private searchMembers(): void {
        this.app.get("/api/members", (req: Request, res: Response, next: NextFunction) => {
            (async () => {
                const query = SearchQuery.safeParse(req.query);

                if (!query.success) {
                    res.status(400).json({
                        status: "error",
                        type: "error",
                        code: "INVALID_MEMBER_SEARCH_QUERY",
                        title: "Invalid request",
                        subtitle: "",
                        details: "searchText must be a string.",
                    });
                    return;
                }

                const found = await this.members.search(query.data.searchText ?? "", SEARCH_RESULT_LIMIT);

                res.status(200).json(found.map(toMemberData));
            })().catch((error: unknown) => {
                console.error(`[${new Date().toISOString()}] Failed to search members`, error);
                next(error);
            });
        });
    }

    private getMember(): void {
        this.app.get("/api/members/:id", (req: Request, res: Response, next: NextFunction) => {
            (async () => {
                // Express decodes percent-encoding for us, which matters because the pusher builds this URL by
                // interpolating the identifier without encoding it. The parameter is typed as possibly repeated;
                // a single segment can only ever produce one value, so take the first.
                const rawId = req.params.id;
                const email = (Array.isArray(rawId) ? rawId[0] : rawId) ?? "";
                const member = await this.members.findByEmail(email);

                if (member === undefined) {
                    // A typed 404 rather than Express's HTML. `AdminApi.getMember` does not validate what it
                    // receives, so an HTML body would surface as a confusing parse error far from here.
                    res.status(404).json({
                        status: "error",
                        type: "error",
                        code: "MEMBER_NOT_FOUND",
                        title: "Member not found",
                        subtitle: "",
                        details: `No member matches "${email}".`,
                    });
                    return;
                }

                res.status(200).json(toMemberData(member));
            })().catch((error: unknown) => {
                console.error(`[${new Date().toISOString()}] Failed to fetch a member`, error);
                next(error);
            });
        });
    }
}

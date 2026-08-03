import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { toAdminMemberView } from "../../Application/AdminMemberView";
import {
    grantTagToMember,
    revokeTagFromMember,
    setMemberDisplayName,
    type Actor,
    type MemberAdministration,
} from "../../Application/MemberAdministrationService";
import { normalizeEmail } from "../../Domain/Member";

/**
 * How many members one answer may carry.
 *
 * The dashboard renders the whole list, so this is both a query bound and a screen bound. It becomes a page size the
 * moment a real deployment outgrows it; until then a cap is honest and pagination is speculation.
 */
const LIST_LIMIT = 200;

/** RFC 5321's maximum address length. Longer input is a mistake or an attack, never an address. */
const MAX_EMAIL_LENGTH = 320;

/**
 * Bounds on free text that becomes a database row.
 *
 * The columns are `text` with no limit of their own, and `express.json` caps the *body* at 100 kB — which still
 * leaves room for a 100 kB tag name. These are where that stops.
 */
const MAX_TAG_LENGTH = 64;
const MAX_USERNAME_LENGTH = 128;

const SearchQuery = z.object({
    /**
     * Absent or empty lists everyone, unlike the pusher-facing `/api/members`.
     *
     * The difference is deliberate: that endpoint feeds a picker that asks on every keystroke, including the one that
     * clears the field, so answering "everyone" there would be a surprise. This one opens as a list.
     */
    search: z.string().max(MAX_EMAIL_LENGTH).optional(),
});

const GrantTagBody = z.object({
    tag: z.string().trim().min(1, "A tag name is required.").max(MAX_TAG_LENGTH),
});

const SetNameBody = z.object({
    /** `null` clears the name. An all-whitespace string does the same, rather than storing blanks. */
    username: z.string().max(MAX_USERNAME_LENGTH).nullable(),
});

function errorBody(code: string, title: string, details: string): Record<string, string> {
    return { status: "error", type: "error", code, title, subtitle: "", details };
}

/**
 * Reads a single path parameter.
 *
 * Express types a parameter as possibly repeated; a single segment can only ever produce one value, so take the
 * first. Percent-encoding is already decoded for us, which is what lets an email — or a tag containing a slash —
 * travel in the path at all.
 */
function pathParam(req: Request, name: string): string {
    const raw = req.params[name];

    return (Array.isArray(raw) ? raw[0] : raw) ?? "";
}

function memberNotFound(res: Response, email: string): void {
    res.status(404).json(
        errorBody("ADMIN_MEMBER_NOT_FOUND", "Member not found", `No member matches "${normalizeEmail(email)}".`),
    );
}

/**
 * `/admin/api/members*` — the dashboard's member management (ADR-0004, G1).
 *
 * Thin over {@link MemberAdministration}: the semantics of granting and revoking live in the Application service the
 * CLI also calls, so the two surfaces cannot come to disagree about what a grant means.
 *
 * Every route here sits behind `adminSessionAuthentication`, which has already proven the session, re-read the
 * `admin` tag from the database, and — for the three mutations — checked the CSRF token. None of that is repeated
 * here, and none of it is optional: this controller is only ever mounted inside that barrier.
 */
export class AdminMembersController {
    constructor(
        private readonly app: Express,
        private readonly administration: MemberAdministration,
    ) {
        this.listMembers();
        this.getMember();
        this.setName();
        this.grantTag();
        this.revokeTag();
    }

    /**
     * The administrator this request acts as.
     *
     * Taken from `req.adminMember`, which the session barrier read from the database on this very request — never
     * from anything the caller supplied. Writing the audit log is the service's job, not this controller's; all it
     * needs from here is a name it can stand behind.
     */
    private actor(req: Request): Actor {
        const acting = req.adminMember;

        if (acting === undefined) {
            // Unreachable behind the barrier. Throwing rather than falling back to an anonymous actor: an audit
            // trail that cannot name who acted is worse than a failed request.
            throw new Error("A dashboard mutation reached its handler with no acting administrator.");
        }

        return { kind: "administrator", email: acting.email };
    }

    private listMembers(): void {
        this.app.get("/admin/api/members", (req: Request, res: Response, next: NextFunction) => {
            (async () => {
                const query = SearchQuery.safeParse(req.query);

                if (!query.success) {
                    res.status(400).json(
                        errorBody("ADMIN_INVALID_SEARCH", "Invalid request", "search must be a string."),
                    );
                    return;
                }

                const search = query.data.search?.trim() ?? "";
                const found =
                    search === ""
                        ? await this.administration.members.listAll(LIST_LIMIT)
                        : await this.administration.members.searchWithTags(search, LIST_LIMIT);

                res.status(200).json(found.map(toAdminMemberView));
            })().catch((error: unknown) => {
                console.error(`[${new Date().toISOString()}] Failed to list members for the dashboard`, error);
                next(error);
            });
        });
    }

    private getMember(): void {
        this.app.get("/admin/api/members/:email", (req: Request, res: Response, next: NextFunction) => {
            (async () => {
                const email = pathParam(req, "email");
                const member = await this.administration.members.findByEmail(email);

                if (member === undefined) {
                    memberNotFound(res, email);
                    return;
                }

                res.status(200).json(toAdminMemberView(member));
            })().catch((error: unknown) => {
                console.error(`[${new Date().toISOString()}] Failed to fetch a member for the dashboard`, error);
                next(error);
            });
        });
    }

    private setName(): void {
        this.app.patch("/admin/api/members/:email", (req: Request, res: Response, next: NextFunction) => {
            (async () => {
                const body = SetNameBody.safeParse(req.body);

                if (!body.success) {
                    res.status(400).json(
                        errorBody(
                            "ADMIN_INVALID_MEMBER_UPDATE",
                            "Invalid request",
                            `username must be a string of at most ${MAX_USERNAME_LENGTH} characters, or null.`,
                        ),
                    );
                    return;
                }

                const email = pathParam(req, "email");
                const updated = await setMemberDisplayName(
                    this.administration,
                    this.actor(req),
                    email,
                    body.data.username,
                );

                if (updated === undefined) {
                    // Not created from a typo: that would leave a ghost account nobody ever logs into. Granting a tag
                    // is how a member comes into existence ahead of their first login.
                    memberNotFound(res, email);
                    return;
                }

                res.status(200).json({ member: toAdminMemberView(updated) });
            })().catch((error: unknown) => {
                console.error(`[${new Date().toISOString()}] Failed to set a member's name`, error);
                next(error);
            });
        });
    }

    private grantTag(): void {
        this.app.post("/admin/api/members/:email/tags", (req: Request, res: Response, next: NextFunction) => {
            (async () => {
                const body = GrantTagBody.safeParse(req.body);

                if (!body.success) {
                    res.status(400).json(
                        errorBody(
                            "ADMIN_INVALID_TAG",
                            "Invalid request",
                            `tag must be a non-empty string of at most ${MAX_TAG_LENGTH} characters.`,
                        ),
                    );
                    return;
                }

                const email = pathParam(req, "email");

                if (email.trim() === "") {
                    res.status(400).json(
                        errorBody("ADMIN_INVALID_EMAIL", "Invalid request", "An email is required in the path."),
                    );
                    return;
                }

                const result = await grantTagToMember(this.administration, this.actor(req), email, body.data.tag);

                if (result.outcome === "protected-tag") {
                    // 403, and the reason spelled out: this is a rule, not a bug, and the next person needs to know
                    // where the privilege actually lives (threat model, F1).
                    res.status(403).json(
                        errorBody(
                            "ADMIN_TAG_PROTECTED",
                            "Forbidden",
                            `The "${result.tagName}" tag cannot be granted through the dashboard or the CLI. ` +
                                "It is assigned with direct SQL against the admin-api database.",
                        ),
                    );
                    return;
                }

                // 200, not 201: granting is idempotent, so the second call creates nothing and there is no new
                // resource to point at.
                res.status(200).json({
                    member: toAdminMemberView(result.member),
                    // The dashboard warns on this. Tags are free text and case-sensitive, so "Admin" is a brand new
                    // label that grants nothing — a mistake worth surfacing at the click, not at the next login.
                    createdTag: result.createdTag,
                });
            })().catch((error: unknown) => {
                console.error(`[${new Date().toISOString()}] Failed to grant a tag`, error);
                next(error);
            });
        });
    }

    private revokeTag(): void {
        this.app.delete("/admin/api/members/:email/tags/:tag", (req: Request, res: Response, next: NextFunction) => {
            (async () => {
                const email = pathParam(req, "email");
                const tag = pathParam(req, "tag");

                const result = await revokeTagFromMember(this.administration, this.actor(req), email, tag);

                if (result.outcome === "member-not-found") {
                    memberNotFound(res, email);
                    return;
                }

                if (result.outcome === "tag-not-found") {
                    res.status(404).json(errorBody("ADMIN_TAG_NOT_FOUND", "Tag not found", `No tag named "${tag}".`));
                    return;
                }

                res.status(200).json({
                    member: toAdminMemberView(result.member),
                    // Revoking a tag the member never held is not an error, but it is worth saying so: it usually
                    // means the screen was showing something stale.
                    wasHeld: result.wasHeld,
                });
            })().catch((error: unknown) => {
                console.error(`[${new Date().toISOString()}] Failed to revoke a tag`, error);
                next(error);
            });
        });
    }
}

import {
    CLI_ACTOR,
    grantTagToMember,
    revokeTagFromMember,
    setMemberDisplayName,
} from "../Application/MemberAdministrationService";
import type { AuditLogRepository } from "../Application/Ports/AuditLogRepository";
import type { MemberRepository } from "../Application/Ports/MemberRepository";
import type { TagRepository } from "../Application/Ports/TagRepository";
import { normalizeEmail } from "../Domain/Member";

/** Enough for a terminal. Beyond this a listing stops being readable and the dashboard is the right tool. */
const LIST_LIMIT = 500;

export interface CommandContext {
    members: MemberRepository;
    tags: TagRepository;
    /**
     * Every change made here is recorded too (ADR-0004, decision #5), attributed to `cli`.
     *
     * The CLI has no logged-in identity, so the entry says "somebody with shell access to the container did this"
     * rather than inventing a name. A gap would be worse: the log's whole value is that it has no gaps.
     */
    audit: AuditLogRepository;
    /** Injected so tests can capture output instead of writing to the terminal. */
    out: (line: string) => void;
}

/**
 * Outcome of a command.
 *
 * Exit codes follow the project convention: 0 success, 1 the operator asked for something impossible, 2 the
 * environment is wrong. Commands here only ever produce 0 or 1 — connection problems surface before they run.
 */
export interface CommandResult {
    exitCode: 0 | 1;
}

const ok: CommandResult = { exitCode: 0 };
const failed: CommandResult = { exitCode: 1 };

function formatMemberRow(email: string, username: string | null, tags: readonly string[]): string {
    const name = username ?? "—";
    const tagList = tags.length > 0 ? [...tags].sort().join(", ") : "—";

    return `${email.padEnd(36)} ${name.padEnd(20)} ${tagList}`;
}

/** Lists every member with the tags they hold. */
export async function listMembers({ members, out }: CommandContext): Promise<CommandResult> {
    const all = await members.listAll(LIST_LIMIT);

    if (all.length === 0) {
        out("No members yet.");
        return ok;
    }

    out(`${"EMAIL".padEnd(36)} ${"NAME".padEnd(20)} TAGS`);
    for (const member of all) {
        out(formatMemberRow(member.email, member.username, member.tags));
    }
    out(`\n${all.length} member(s).`);

    return ok;
}

/**
 * Shows the most recent audit entries, newest first.
 *
 * The terminal answer to "who granted this, and when" — available when the dashboard is down, which is exactly when
 * somebody is likely to be asking.
 */
export async function listAudit(
    { audit, out }: CommandContext,
    targetEmail: string | undefined,
): Promise<CommandResult> {
    const entries =
        targetEmail === undefined || targetEmail.trim() === ""
            ? await audit.listRecent(LIST_LIMIT)
            : await audit.listForTarget(targetEmail, LIST_LIMIT);

    if (entries.length === 0) {
        out(targetEmail ? `Nothing recorded for "${normalizeEmail(targetEmail)}".` : "Nothing recorded yet.");
        return ok;
    }

    out(`${"WHEN".padEnd(26)} ${"ACTOR".padEnd(30)} ${"ACTION".padEnd(16)} ${"TARGET".padEnd(30)} DETAILS`);
    for (const entry of entries) {
        out(
            `${entry.createdAt.toISOString().padEnd(26)} ${entry.actorEmail.padEnd(30)} ` +
                `${entry.action.padEnd(16)} ${entry.targetEmail.padEnd(30)} ${JSON.stringify(entry.details)}`,
        );
    }
    out(`\n${entries.length} entr${entries.length === 1 ? "y" : "ies"}.`);

    return ok;
}

/** Lists the tag catalogue. */
export async function listTags({ tags, out }: CommandContext): Promise<CommandResult> {
    const all = await tags.listAll();

    if (all.length === 0) {
        out("No tags yet.");
        return ok;
    }

    for (const name of all) {
        out(name);
    }

    return ok;
}

/**
 * Grants a tag, creating the member and the tag if either is new.
 *
 * The semantics live in {@link grantTagToMember}, shared with the dashboard's `POST /admin/api/members/:email/tags`.
 * Two surfaces that grant permissions must not be able to disagree about what granting means.
 *
 * The notice on a newly created tag is this surface's own: the CLI can list the tags that already existed, which is
 * how a typo becomes visible immediately rather than at the next login.
 */
export async function grantTag(
    { members, tags, audit, out }: CommandContext,
    email: string,
    tagName: string,
): Promise<CommandResult> {
    if (email.trim() === "" || tagName.trim() === "") {
        out("Usage: member:grant <email> <tag>");
        return failed;
    }

    const known = await tags.listAll();
    const result = await grantTagToMember({ members, tags, audit }, CLI_ACTOR, email, tagName);

    if (result.createdTag) {
        out(`Note: the tag "${result.tagName}" did not exist and was created.`);
        if (known.length > 0) {
            out(`      Existing tags: ${known.join(", ")}`);
        }
    }

    out(`Granted "${result.tagName}" to ${result.member.email}.`);

    return ok;
}

/** Revokes a tag. Revoking one the member does not hold is reported, not treated as an error. */
export async function revokeTag(
    { members, tags, audit, out }: CommandContext,
    email: string,
    tagName: string,
): Promise<CommandResult> {
    if (email.trim() === "" || tagName.trim() === "") {
        out("Usage: member:revoke <email> <tag>");
        return failed;
    }

    const result = await revokeTagFromMember({ members, tags, audit }, CLI_ACTOR, email, tagName);

    if (result.outcome === "member-not-found") {
        out(`No member with email "${normalizeEmail(email)}".`);
        return failed;
    }

    if (result.outcome === "tag-not-found") {
        out(`No tag named "${tagName}".`);
        return failed;
    }

    out(
        result.wasHeld
            ? `Revoked "${tagName}" from ${result.member.email}.`
            : `${result.member.email} did not hold "${tagName}".`,
    );

    return ok;
}

/**
 * Sets a member's display name, which is what the map editor's member picker shows instead of a bare email.
 *
 * Only works on an existing member: creating one from a typo here would produce an account nobody ever logs into.
 */
export async function setMemberName(
    { members, tags, audit, out }: CommandContext,
    email: string,
    name: string,
): Promise<CommandResult> {
    if (email.trim() === "") {
        out("Usage: member:set-name <email> <name>");
        return failed;
    }

    const updated = await setMemberDisplayName({ members, tags, audit }, CLI_ACTOR, email, name);

    if (updated === undefined) {
        out(`No member with email "${normalizeEmail(email)}". Grant them a tag first, or let them log in once.`);
        return failed;
    }

    out(
        updated.username === null
            ? `Cleared the name of ${updated.email}.`
            : `${updated.email} is now "${updated.username}".`,
    );

    return ok;
}

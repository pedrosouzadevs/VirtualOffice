import type { MemberRepository } from "../Application/Ports/MemberRepository";
import type { TagRepository } from "../Application/Ports/TagRepository";
import { normalizeEmail } from "../Domain/Member";

/** Enough for a terminal. Beyond this a listing stops being readable and the dashboard is the right tool. */
const LIST_LIMIT = 500;

export interface CommandContext {
    members: MemberRepository;
    tags: TagRepository;
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
 * Creating the tag on demand is deliberate: the map editor's pickers accept free text, so an arbitrary tag is a
 * meaningful thing to gate an area on. The trade-off is that a typo silently becomes a new tag, so a notice listing
 * the tags that already existed is printed whenever one is created — the mistake is then visible immediately rather
 * than at the next login.
 */
export async function grantTag(
    { members, tags, out }: CommandContext,
    email: string,
    tagName: string,
): Promise<CommandResult> {
    if (email.trim() === "" || tagName.trim() === "") {
        out("Usage: member:grant <email> <tag>");
        return failed;
    }

    const existingTag = await tags.findByName(tagName);

    if (existingTag === undefined) {
        const known = await tags.listAll();
        out(`Note: the tag "${tagName}" did not exist and was created.`);
        if (known.length > 0) {
            out(`      Existing tags: ${known.join(", ")}`);
        }
    }

    const member = await members.ensureMember(email);
    const tag = existingTag ?? (await members.ensureTag(tagName));
    await members.grantTag(member.id, tag.id);

    out(`Granted "${tag.name}" to ${member.email}.`);

    return ok;
}

/** Revokes a tag. Revoking one the member does not hold is reported, not treated as an error. */
export async function revokeTag(
    { members, tags, out }: CommandContext,
    email: string,
    tagName: string,
): Promise<CommandResult> {
    if (email.trim() === "" || tagName.trim() === "") {
        out("Usage: member:revoke <email> <tag>");
        return failed;
    }

    const member = await members.findByEmail(email);
    if (member === undefined) {
        out(`No member with email "${normalizeEmail(email)}".`);
        return failed;
    }

    const tag = await tags.findByName(tagName);
    if (tag === undefined) {
        out(`No tag named "${tagName}".`);
        return failed;
    }

    const held = member.tags.includes(tag.name);
    await members.revokeTag(member.id, tag.id);

    out(held ? `Revoked "${tag.name}" from ${member.email}.` : `${member.email} did not hold "${tag.name}".`);

    return ok;
}

/**
 * Sets a member's display name, which is what the map editor's member picker shows instead of a bare email.
 *
 * Only works on an existing member: creating one from a typo here would produce an account nobody ever logs into.
 */
export async function setMemberName(
    { members, out }: CommandContext,
    email: string,
    name: string,
): Promise<CommandResult> {
    if (email.trim() === "") {
        out("Usage: member:set-name <email> <name>");
        return failed;
    }

    const trimmed = name.trim();
    const updated = await members.setUsername(email, trimmed === "" ? null : trimmed);

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

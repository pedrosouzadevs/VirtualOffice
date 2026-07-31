import type { Member } from "../Domain/Member";
import { normalizeEmail } from "../Domain/Member";
import type { MemberRepository } from "./Ports/MemberRepository";
import type { TagRepository } from "./Ports/TagRepository";

/**
 * The two repositories every operation here needs.
 *
 * Bundled so the CLI and the dashboard pass the same thing, and so adding a third store later is one signature change
 * rather than one per call site.
 */
export interface MemberAdministration {
    readonly members: MemberRepository;
    readonly tags: TagRepository;
}

export interface GrantTagResult {
    /** The member **after** the grant, so callers never render a stale tag list. */
    readonly member: Member;
    readonly tagName: string;
    /**
     * Whether the tag did not exist and was created by this call.
     *
     * Worth returning rather than swallowing: tags are free text, so `Admin` is a different tag from `admin` and a
     * typo silently becomes a new label that grants nothing. The CLI prints a notice; the dashboard shows a warning.
     * Either way the mistake surfaces now instead of at the next login.
     */
    readonly createdTag: boolean;
}

export type RevokeTagResult =
    | { readonly outcome: "revoked"; readonly member: Member; readonly wasHeld: boolean }
    | { readonly outcome: "member-not-found" }
    | { readonly outcome: "tag-not-found" };

/**
 * Grants a tag, creating the member and the tag if either is new.
 *
 * Creating on demand is deliberate (ADR-0003): the map editor's pickers accept free text, so an arbitrary tag is a
 * meaningful thing to gate an area on, and a member who has never logged in is a meaningful person to prepare access
 * for. Idempotent — granting twice is not an error.
 */
export async function grantTagToMember(
    { members, tags }: MemberAdministration,
    email: string,
    tagName: string,
): Promise<GrantTagResult> {
    const existingTag = await tags.findByName(tagName);

    const member = await members.ensureMember(email);
    const tag = existingTag ?? (await members.ensureTag(tagName));
    await members.grantTag(member.id, tag.id);

    // Re-read rather than patching the object in memory: `ensureMember` answered before the grant existed, and a
    // caller that renders its `tags` would show the state from one moment ago.
    const updated = await members.findByEmail(member.email);

    return {
        member: updated ?? member,
        tagName: tag.name,
        createdTag: existingTag === undefined,
    };
}

/**
 * Revokes a tag.
 *
 * Distinguishes "no such member" from "no such tag" because the two are different mistakes, and because revoking a
 * tag the member does not hold is **not** one — that case succeeds with `wasHeld: false`.
 */
export async function revokeTagFromMember(
    { members, tags }: MemberAdministration,
    email: string,
    tagName: string,
): Promise<RevokeTagResult> {
    const member = await members.findByEmail(email);

    if (member === undefined) {
        return { outcome: "member-not-found" };
    }

    const tag = await tags.findByName(tagName);

    if (tag === undefined) {
        // Looked up rather than ensured: `ensureTag` would create the very tag we are about to remove.
        return { outcome: "tag-not-found" };
    }

    const wasHeld = member.tags.includes(tag.name);
    await members.revokeTag(member.id, tag.id);

    const updated = await members.findByEmail(member.email);

    return { outcome: "revoked", member: updated ?? member, wasHeld };
}

/**
 * Sets a member's display name, which is what the map editor's member picker shows instead of a bare email.
 *
 * An empty name clears it. Only works on an existing member: creating one from a typo here would produce an account
 * nobody ever logs into.
 *
 * @returns the updated member, or `undefined` when no member has that email.
 */
export function setMemberDisplayName(
    { members }: MemberAdministration,
    email: string,
    name: string | null,
): Promise<Member | undefined> {
    const trimmed = name?.trim() ?? "";

    return members.setUsername(email, trimmed === "" ? null : trimmed);
}

/** Normalises an email the same way storage does, for messages that name an address the caller got wrong. */
export function displayEmail(email: string): string {
    return normalizeEmail(email);
}

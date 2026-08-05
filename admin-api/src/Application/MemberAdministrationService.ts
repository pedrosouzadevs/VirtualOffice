import type { AuditAction } from "../Domain/AuditEntry";
import type { Member } from "../Domain/Member";
import { isProtectedTag, normalizeEmail } from "../Domain/Member";
import { actorLabel, recordAudit, type Actor } from "./AuditRecording";
import type { AdminAlert, AdminAlerter } from "./Ports/AdminAlerter";
import type { AuditLogRepository } from "./Ports/AuditLogRepository";
import type { MemberRepository } from "./Ports/MemberRepository";
import type { TagRepository } from "./Ports/TagRepository";

/**
 * The repositories every operation here needs.
 *
 * Bundled so the CLI and the dashboard pass the same thing, and so adding a store later is one signature change
 * rather than one per call site.
 */
export interface MemberAdministration {
    readonly members: MemberRepository;
    readonly tags: TagRepository;
    readonly audit: AuditLogRepository;
    /** Where the events of [F1](../../../docs/security/threat-model.md#6-open-findings) are shouted about. */
    readonly alerter: AdminAlerter;
}

/**
 * Re-exported from {@link AuditRecording}, where they moved once banning became a second writer to the audit log
 * (ADR-0005). Every existing import keeps working, and there is still only one definition of what an actor is.
 */
export { CLI_ACTOR, type Actor } from "./AuditRecording";

/**
 * Raises an alert without letting it affect the caller.
 *
 * Same policy as the audit write, and for a stronger reason: an alert describes something that already happened, so
 * a monitoring failure must never become an outage.
 */
async function raise({ alerter }: MemberAdministration, alert: AdminAlert): Promise<void> {
    try {
        await alerter.raise(alert);
    } catch (error: unknown) {
        console.error(`[${new Date().toISOString()}] Failed to raise ${alert.kind}`, error);
    }
}

/** Records against this service's own repositories. The semantics live in {@link recordAudit}. */
async function record(
    { audit }: MemberAdministration,
    actor: Actor,
    action: AuditAction,
    targetEmail: string,
    details: Record<string, unknown>,
): Promise<void> {
    await recordAudit(audit, actor, action, targetEmail, details);
}

export type GrantTagResult =
    | {
          readonly outcome: "granted";
          /** The member **after** the grant, so callers never render a stale tag list. */
          readonly member: Member;
          readonly tagName: string;
          /**
           * Whether the tag did not exist and was created by this call.
           *
           * Worth returning rather than swallowing: tags are free text, so `Admin` is a different tag from `admin`
           * and a typo silently becomes a new label that grants nothing. The CLI prints a notice; the dashboard
           * shows a warning. Either way the mistake surfaces now instead of at the next login.
           */
          readonly createdTag: boolean;
      }
    | {
          /** The tag may only be granted with direct SQL. See {@link PROTECTED_TAGS} and threat model F1. */
          readonly outcome: "protected-tag";
          readonly tagName: string;
      };

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
    administration: MemberAdministration,
    actor: Actor,
    email: string,
    tagName: string,
): Promise<GrantTagResult> {
    const { members, tags } = administration;

    if (isProtectedTag(tagName)) {
        // Refused before anything is written. The attempt is recorded and shouted about: from here it is either
        // somebody who does not know the rule, or somebody who does (threat model, F1).
        const target = normalizeEmail(email);

        await record(administration, actor, "tag.grant_refused", target, { tag: tagName.trim() });
        await raise(administration, {
            kind: "admin.grant.refused",
            actor: actorLabel(actor),
            target,
            detail: `An attempt to grant "${tagName.trim()}" was refused. That tag can only be granted with direct SQL.`,
        });

        return { outcome: "protected-tag", tagName: tagName.trim() };
    }

    const existingTag = await tags.findByName(tagName);

    const member = await members.ensureMember(email);
    const tag = existingTag ?? (await members.ensureTag(tagName));
    await members.grantTag(member.id, tag.id);

    // Re-read rather than patching the object in memory: `ensureMember` answered before the grant existed, and a
    // caller that renders its `tags` would show the state from one moment ago.
    const updated = await members.findByEmail(member.email);
    const createdTag = existingTag === undefined;

    await record(administration, actor, "tag.granted", member.email, {
        tag: tag.name,
        // Recorded because it is the difference between granting a permission and inventing a label.
        createdTag,
    });

    return { outcome: "granted", member: updated ?? member, tagName: tag.name, createdTag };
}

/**
 * Revokes a tag.
 *
 * Distinguishes "no such member" from "no such tag" because the two are different mistakes, and because revoking a
 * tag the member does not hold is **not** one — that case succeeds with `wasHeld: false`.
 */
export async function revokeTagFromMember(
    administration: MemberAdministration,
    actor: Actor,
    email: string,
    tagName: string,
): Promise<RevokeTagResult> {
    const { members, tags } = administration;
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

    // Recorded even when nothing changed: somebody deliberately asked for this person to lose that tag, and that
    // intent is exactly what the log is asked about later.
    await record(administration, actor, "tag.revoked", member.email, { tag: tag.name, wasHeld });

    if (isProtectedTag(tag.name) && wasHeld) {
        // Revoking `admin` stays allowed — needing a DBA to remove an administrator during an incident would be the
        // wrong trade — but the set of administrators shrinking is never something to discover by accident.
        await raise(administration, {
            kind: "admin.revoked",
            actor: actorLabel(actor),
            target: member.email,
            detail: `The "${tag.name}" tag was revoked. Granting it back requires direct SQL.`,
        });
    }

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
export async function setMemberDisplayName(
    administration: MemberAdministration,
    actor: Actor,
    email: string,
    name: string | null,
): Promise<Member | undefined> {
    const trimmed = name?.trim() ?? "";
    const updated = await administration.members.setUsername(email, trimmed === "" ? null : trimmed);

    if (updated === undefined) {
        return undefined;
    }

    await record(administration, actor, "member.renamed", updated.email, { username: updated.username });

    return updated;
}

/** Normalises an email the same way storage does, for messages that name an address the caller got wrong. */
export function displayEmail(email: string): string {
    return normalizeEmail(email);
}

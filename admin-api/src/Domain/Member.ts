/**
 * A member without their tags loaded.
 *
 * Enough to build a `MemberData`, which carries no tags, so searches do not pay for a join they cannot use.
 */
export interface MemberSummary {
    readonly id: string;
    readonly email: string;
    readonly username: string | null;
}

/**
 * A member of the world, as the rest of the application sees them.
 *
 * `id` is ours and internal; `email` and `oidcSub` are external identifiers that may change over a person's lifetime
 * without changing who they are (ADR-0002, decision #5).
 */
export interface Member extends MemberSummary {
    readonly oidcSub: string | null;
    /** Authorisation labels, e.g. `admin`, `editor`. */
    readonly tags: readonly string[];
}

/** Tags that grant map-editor access. Mirrors the check `LocalAdmin.fetchMemberDataByUuid` performs today. */
export const MAP_EDITOR_TAGS = ["admin", "editor"] as const;

/**
 * Tags no application surface may grant — only direct SQL, and the idempotent bootstrap.
 *
 * `admin` is here because of finding F1 of the [threat model](../../../docs/security/threat-model.md): an attacker
 * holding an administrator's browser session for a minute could otherwise grant `admin` to an address they control.
 * The session dies within twelve hours; the grant would not. A temporary compromise would become permanent access
 * surviving session expiry, password reset and revoking the original account.
 *
 * Closing that means the privilege cannot be reached from anything an attacker can steal — not the dashboard, not
 * the CLI, both of which go through `MemberAdministrationService`. What is left is a database session, which is a
 * different and much harder thing to obtain.
 *
 * **Revoking `admin` is deliberately still allowed.** Removing an administrator is a safety action, and needing a
 * DBA to perform it during an incident would be the wrong trade.
 */
export const PROTECTED_TAGS: readonly string[] = ["admin"];

/** Whether a tag may only be granted outside the application. Case-sensitive, like every other tag comparison here. */
export function isProtectedTag(name: string): boolean {
    return PROTECTED_TAGS.includes(name.trim());
}

/**
 * Normalises an email for storage and lookup.
 *
 * Mail addresses are case-insensitive in practice but an identity provider may send any casing, and the pusher
 * forwards whatever it received. Normalising on both write and read is what stops the same person from being treated
 * as two members.
 */
export function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

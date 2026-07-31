/**
 * A member of the world, as the rest of the application sees them.
 *
 * `id` is ours and internal; `email` and `oidcSub` are external identifiers that may change over a person's lifetime
 * without changing who they are (ADR-0002, decision #5).
 */
export interface Member {
    readonly id: string;
    readonly email: string;
    readonly oidcSub: string | null;
    readonly username: string | null;
    /** Authorisation labels, e.g. `admin`, `editor`. */
    readonly tags: readonly string[];
}

/** Tags that grant map-editor access. Mirrors the check `LocalAdmin.fetchMemberDataByUuid` performs today. */
export const MAP_EDITOR_TAGS = ["admin", "editor"] as const;

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

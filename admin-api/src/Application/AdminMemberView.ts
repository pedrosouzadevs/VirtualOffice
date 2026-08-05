import type { Member } from "../Domain/Member";

/**
 * A member as the **dashboard** sees them.
 *
 * Deliberately not `MemberData`, which is the pusher's contract and lives in `@workadventure/messages`: that shape is
 * owned by someone else and must not start growing fields because a screen wanted them.
 *
 * The identifier is the email. The internal primary key never leaves the database — the same rule the pusher-facing
 * API follows, and for the same reason (ADR-0002, decision #5).
 */
export interface AdminMemberView {
    readonly email: string;
    readonly username: string | null;
    readonly tags: string[];
}

export function toAdminMemberView(member: Member): AdminMemberView {
    return {
        email: member.email,
        username: member.username,
        // Copied, and sorted so a list does not reshuffle between renders for no reason.
        tags: [...member.tags].sort((a, b) => a.localeCompare(b)),
    };
}

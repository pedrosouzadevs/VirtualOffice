import type { Member, MemberSummary } from "../../Domain/Member";

/**
 * Persistence the application needs, declared here so the dependency points inward: Application owns the contract,
 * Infrastructure implements it (ADR-0002, decision #1).
 */
export interface MemberRepository {
    /**
     * Looks a member up by email, tags included.
     *
     * @returns `undefined` when nobody matches. Callers must treat that as "a visitor we have never seen", not as an
     * error: `/api/room/access` has to let unknown people in with no tags, otherwise no new user could ever enter.
     */
    findByEmail(email: string): Promise<Member | undefined>;

    /**
     * Finds members whose email or name contains `searchText`, case-insensitively.
     *
     * Feeds the map editor's member picker, which searches as the user types. Bounded by `limit` because that picker
     * renders every result: an unbounded answer would be a slow query *and* an unusable dropdown.
     *
     * An empty `searchText` returns nothing rather than everyone — the picker asks on every keystroke, including the
     * one that clears the field.
     */
    search(searchText: string, limit: number): Promise<MemberSummary[]>;

    /** Every member with their tags, ordered by email. Bounded because it feeds a terminal, not a paginated screen. */
    listAll(limit: number): Promise<Member[]>;

    /** Removes a grant. Idempotent: revoking a tag the member does not hold is not an error. */
    revokeTag(memberId: string, tagId: string): Promise<void>;

    /**
     * Sets a member's display name.
     *
     * @returns the updated member, or `undefined` when no member has that email. Creating one here would turn a typo
     * into a ghost account.
     */
    setUsername(email: string, username: string | null): Promise<Member | undefined>;

    /** Creates the member if the email is new, otherwise leaves the existing row untouched. Idempotent. */
    ensureMember(email: string, username?: string): Promise<Member>;

    /** Creates the tag if the name is new. Idempotent. */
    ensureTag(name: string): Promise<{ id: string; name: string }>;

    /** Grants a tag to a member. Idempotent: granting twice is not an error. */
    grantTag(memberId: string, tagId: string): Promise<void>;
}

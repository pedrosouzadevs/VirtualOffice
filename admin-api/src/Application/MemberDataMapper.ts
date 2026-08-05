import { MemberData } from "@workadventure/messages";
import type { MemberSummary } from "../Domain/Member";

/**
 * Turns a member into the `MemberData` the pusher expects.
 *
 * ⚠️ **`id` is the email, never our internal primary key** (ADR-0003, decision #1). `MemberAutocomplete` writes this
 * value into `personalAreaPropertyData.ownerId`, and `MapEditorModeManager` compares that against the user's local
 * uuid — which is the email, because that is what `/api/room/access` returns as `userUuid`. Returning `member.id`
 * here would let an administrator assign an owner nobody can ever act as, silently breaking F4.
 *
 * The result is parsed through the pusher's own schema before it leaves. `AdminApi.getMember` and
 * `AdminApi.searchTags` do **not** validate what they receive, so a malformed payload from us would surface far from
 * its cause; validating here keeps the failure on our side of the boundary.
 */
export function toMemberData(member: MemberSummary): MemberData {
    return MemberData.parse({
        id: member.email,
        name: member.username,
        email: member.email,
        // Neither is modelled yet. Both are optional in the schema, and both arrive with the dashboard (P2) and the
        // chat integration respectively.
        visitCardUrl: null,
        chatID: null,
    });
}

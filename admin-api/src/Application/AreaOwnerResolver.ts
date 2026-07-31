import type { Area } from "../Domain/Room";
import type { MemberRepository } from "./Ports/MemberRepository";

/**
 * Puts names to the owners of personal areas.
 *
 * The map stores an **email** in `personalAreaPropertyData.ownerId` — the same value `/api/room/access` returns as
 * `userUuid`, which is invariant #2 of ADR-0002 and the reason nothing may change it. That is enough to identify
 * somebody but not enough to read at a glance, so this looks each one up.
 *
 * Owners are looked up once per distinct email rather than once per area: a floor of thirty desks belonging to
 * fifteen people is fifteen queries, not thirty.
 *
 * An email with no member row comes back flagged rather than blank. It usually means an area claimed before the
 * Admin API was switched on, and an administrator seeing "unknown" can act on it; one seeing an empty cell cannot.
 */
export async function resolveAreaOwners(areas: readonly Area[], members: MemberRepository): Promise<Area[]> {
    const emails = [
        ...new Set(
            areas
                .map((area) => area.personal?.ownerId)
                .filter((ownerId): ownerId is string => typeof ownerId === "string" && ownerId.trim() !== ""),
        ),
    ];

    if (emails.length === 0) {
        return [...areas];
    }

    const found = await Promise.all(emails.map((email) => members.findByEmail(email)));
    const byEmail = new Map<string, string | null>();

    emails.forEach((email, index) => {
        const member = found[index];
        if (member !== undefined) {
            byEmail.set(email, member.username);
        }
    });

    return areas.map((area) => {
        if (area.personal?.ownerId == null) {
            return area;
        }

        const { ownerId } = area.personal;

        return {
            ...area,
            personal: {
                ...area.personal,
                ownerName: byEmail.get(ownerId) ?? null,
                ownerUnknown: !byEmail.has(ownerId),
            },
        };
    });
}

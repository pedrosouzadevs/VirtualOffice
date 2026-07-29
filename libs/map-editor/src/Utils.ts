import type { AreaData, LockableAreaPropertyData, PersonalAreaPropertyData } from "./types";
import { SpeakerMegaphonePropertyData } from "./types";

export function getSpeakerMegaphoneAreaName(
    areas: Map<string, AreaData> = new Map(),
    areaId: string,
): string | undefined {
    for (const area of areas.values()) {
        const speakerMegaphonePropertyRaw = area.properties.find((property) => property.type === "speakerMegaphone");
        if (speakerMegaphonePropertyRaw) {
            const speakerMegaphoneProperty = SpeakerMegaphonePropertyData.safeParse(speakerMegaphonePropertyRaw);
            if (speakerMegaphoneProperty.success && area.id === areaId) {
                return speakerMegaphoneProperty.data.name;
            }
        }
    }
    return undefined;
}

/**
 * Retrieves both the speaker megaphone area's name and its seeAttendees value, given an area ID.
 * @param areas Map of area ID to AreaData.
 * @param areaId The target area ID to look up.
 * @returns An object with `name` and `seeAttendees` if found, otherwise undefined.
 */
export function getSpeakerMegaphoneAreaInfo(
    areas: Map<string, AreaData> = new Map(),
    areaId: string,
): { name: string; seeAttendees: boolean } | undefined {
    for (const area of areas.values()) {
        if (area.id !== areaId) {
            continue;
        }
        const property = area.properties.find((property) => property.type === "speakerMegaphone");
        if (!property) {
            return undefined;
        }

        return {
            name: property.name,
            seeAttendees: property.seeAttendees,
        };
    }
    return undefined;
}

/**
 * Owner lock mode requires the area to also carry a personal area property: that is where
 * ownership (the `ownerId`) comes from. This checks that an area's lockable properties are
 * consistent with that rule.
 *
 * Used by the map editor to prevent an invalid setup. The runtime degrades an unbacked
 * "owner" lock to "ephemeral" rather than failing, so this is a guard, not a hard schema
 * constraint.
 *
 * @param area The area to validate.
 * @returns true when the area has no owner-mode lock, or has one backed by a personal area.
 */
export function isAreaOwnerLockValid(area: AreaData): boolean {
    const hasOwnerLock = area.properties.some(
        (property) => property.type === "lockableAreaPropertyData" && property.lockMode === "owner",
    );
    if (!hasOwnerLock) {
        return true;
    }
    return area.properties.some((property) => property.type === "personalAreaPropertyData");
}

/**
 * Single source of truth for who may lock/unlock a lockable area. Used by both the front (to
 * enable/disable the lock button) and the back (to enforce the permission on the server).
 *
 * - "owner" mode: only the personal-area owner may act. If the area has no personal-area owner
 *   (no personal area property, or its ownerId is null), the lock degrades to the legacy
 *   ephemeral behaviour instead of locking everyone out.
 * - "ephemeral" mode (default/legacy): anyone if allowedTags is empty, otherwise the user needs
 *   at least one matching tag.
 *
 * @param area The area whose (first) lockable property is being toggled.
 * @param userTags The acting user's tags.
 * @param userId The acting user's identifier (uuid), or undefined for anonymous users.
 * @returns true when the user may toggle the lock.
 */
export function canToggleAreaLock(area: AreaData, userTags: string[], userId: string | undefined): boolean {
    const lockable = area.properties.find(
        (property): property is LockableAreaPropertyData => property.type === "lockableAreaPropertyData",
    );
    if (!lockable) {
        return false;
    }

    if (lockable.lockMode === "owner") {
        const personalArea = area.properties.find(
            (property): property is PersonalAreaPropertyData => property.type === "personalAreaPropertyData",
        );
        if (personalArea && personalArea.ownerId) {
            return userId !== undefined && personalArea.ownerId === userId;
        }
        // No owner assigned: fall through to the ephemeral/tag-based logic below.
    }

    const allowedTags = lockable.allowedTags ?? [];
    if (allowedTags.length === 0) {
        return true;
    }
    return userTags.some((tag) => allowedTags.includes(tag));
}

/**
 * Whether a user passes through an area's lock as if it were open (ADR-0001). The owner of an
 * owner-locked area is not blocked by their own lock: they can leave and re-enter freely while
 * everyone else stays locked out. Ephemeral locks keep their legacy behaviour (nobody passes).
 *
 * @param area The locked area being entered.
 * @param userId The entering user's identifier (uuid), or undefined for anonymous users.
 * @returns true when the user is the owner of an owner-locked area.
 */
export function canPassAreaLock(area: AreaData, userId: string | undefined): boolean {
    const lockable = area.properties.find(
        (property): property is LockableAreaPropertyData => property.type === "lockableAreaPropertyData",
    );
    if (!lockable || lockable.lockMode !== "owner") {
        return false;
    }
    const personalArea = area.properties.find(
        (property): property is PersonalAreaPropertyData => property.type === "personalAreaPropertyData",
    );
    if (!personalArea || !personalArea.ownerId) {
        return false;
    }
    return userId !== undefined && personalArea.ownerId === userId;
}

/**
 * Single source of truth for whether a user may eject occupants from an area (ADR-0001 §8).
 * Used by both the front (to show/enable the eject button) and the back (to enforce it).
 *
 * Requires the user to be the personal-area owner. An admin can block ejection for a given
 * area by setting `ownerCanEject: false` on its lockable property (editable only in the map
 * editor); `undefined`/`true` means allowed.
 *
 * @param area The area the ejection is requested on.
 * @param userId The requesting user's identifier (uuid), or undefined for anonymous users.
 * @returns true when the user is the owner and ejection is not blocked.
 */
export function canEjectFromArea(area: AreaData, userId: string | undefined): boolean {
    const personalArea = area.properties.find(
        (property): property is PersonalAreaPropertyData => property.type === "personalAreaPropertyData",
    );
    if (!personalArea || !personalArea.ownerId) {
        return false;
    }
    if (userId === undefined || personalArea.ownerId !== userId) {
        return false;
    }

    const lockable = area.properties.find(
        (property): property is LockableAreaPropertyData => property.type === "lockableAreaPropertyData",
    );
    // Admins block ejection per area via this flag; only an explicit false blocks it.
    return lockable?.ownerCanEject !== false;
}

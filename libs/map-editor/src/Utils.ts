import type { AreaData } from "./types";
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

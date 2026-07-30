import { describe, expect, it } from "vitest";
import { AreaData, LockableAreaPropertyData } from "../src/types";
import {
    arePositionsSeparatedByLockedArea,
    canEjectFromArea,
    canPassAreaLock,
    canToggleAreaLock,
    hasEffectiveOwnerLock,
    isAreaOwnerLockValid,
    isPositionInsideArea,
} from "../src/Utils";

/**
 * Regression tests for the owner lock mode added to the lockable area property (F4 / ADR-0001).
 * The core guarantee here is backward compatibility: an existing lockable area with no new
 * fields must still parse and default to the legacy "ephemeral" behaviour with no migration.
 */
describe("LockableAreaPropertyData - owner lock mode", () => {
    const baseLockable = {
        id: "lock-1",
        type: "lockableAreaPropertyData" as const,
    };

    it("defaults a legacy lockable property to ephemeral, keeping existing maps working", () => {
        const parsed = LockableAreaPropertyData.parse(baseLockable);

        expect(parsed.lockMode).toBe("ephemeral");
    });

    it("accepts the owner lock mode", () => {
        const parsed = LockableAreaPropertyData.parse({ ...baseLockable, lockMode: "owner" });

        expect(parsed.lockMode).toBe("owner");
    });

    it("rejects an unknown lock mode", () => {
        expect(() => LockableAreaPropertyData.parse({ ...baseLockable, lockMode: "public" })).toThrow();
    });

    // Maps saved while the abandoned door/grace design was in the schema still carry those keys.
    // The schema is not strict, so they are dropped on parse instead of failing validation.
    it("drops the retired doorGapTiles/gracePeriodSeconds keys from already-saved maps", () => {
        const parsed = LockableAreaPropertyData.parse({
            ...baseLockable,
            lockMode: "owner",
            doorGapTiles: 2,
            gracePeriodSeconds: 300,
        });

        expect(parsed.lockMode).toBe("owner");
        expect(parsed).not.toHaveProperty("doorGapTiles");
        expect(parsed).not.toHaveProperty("gracePeriodSeconds");
    });
});

describe("isAreaOwnerLockValid", () => {
    const makeArea = (properties: unknown[]): AreaData =>
        AreaData.parse({
            id: "area-1",
            x: 0,
            y: 0,
            width: 64,
            height: 64,
            visible: true,
            name: "office",
            properties,
        });

    const ownerLock = { id: "lock-1", type: "lockableAreaPropertyData", lockMode: "owner" };
    const ephemeralLock = { id: "lock-1", type: "lockableAreaPropertyData", lockMode: "ephemeral" };
    const personalArea = {
        id: "personal-1",
        type: "personalAreaPropertyData",
        accessClaimMode: "dynamic",
        ownerId: "user-42",
    };

    it("accepts an owner lock backed by a personal area", () => {
        expect(isAreaOwnerLockValid(makeArea([ownerLock, personalArea]))).toBe(true);
    });

    it("rejects an owner lock with no personal area", () => {
        expect(isAreaOwnerLockValid(makeArea([ownerLock]))).toBe(false);
    });

    it("accepts an ephemeral lock with no personal area (legacy setup)", () => {
        expect(isAreaOwnerLockValid(makeArea([ephemeralLock]))).toBe(true);
    });

    it("accepts an area with no lockable property at all", () => {
        expect(isAreaOwnerLockValid(makeArea([]))).toBe(true);
    });
});

describe("canToggleAreaLock", () => {
    const makeArea = (properties: unknown[]): AreaData =>
        AreaData.parse({
            id: "area-1",
            x: 0,
            y: 0,
            width: 64,
            height: 64,
            visible: true,
            name: "office",
            properties,
        });

    const ownerLock = { id: "lock-1", type: "lockableAreaPropertyData", lockMode: "owner" };
    const ephemeralLock = { id: "lock-1", type: "lockableAreaPropertyData", lockMode: "ephemeral" };
    const restrictedEphemeralLock = {
        id: "lock-1",
        type: "lockableAreaPropertyData",
        lockMode: "ephemeral",
        allowedTags: ["admin"],
    };
    const personalArea = (ownerId: string | null) => ({
        id: "personal-1",
        type: "personalAreaPropertyData",
        accessClaimMode: "dynamic",
        ownerId,
    });

    describe("owner mode", () => {
        it("lets the personal-area owner toggle the lock", () => {
            expect(canToggleAreaLock(makeArea([ownerLock, personalArea("user-42")]), [], "user-42")).toBe(true);
        });

        it("denies a non-owner, regardless of tags", () => {
            expect(canToggleAreaLock(makeArea([ownerLock, personalArea("user-42")]), ["admin"], "user-99")).toBe(false);
        });

        it("denies an anonymous user (no uuid)", () => {
            expect(canToggleAreaLock(makeArea([ownerLock, personalArea("user-42")]), [], undefined)).toBe(false);
        });

        it("degrades to ephemeral when the area has no personal area (anyone may toggle)", () => {
            expect(canToggleAreaLock(makeArea([ownerLock]), [], "user-99")).toBe(true);
        });

        it("degrades to ephemeral when the personal area is unclaimed (ownerId null)", () => {
            expect(canToggleAreaLock(makeArea([ownerLock, personalArea(null)]), [], "user-99")).toBe(true);
        });
    });

    describe("ephemeral mode", () => {
        it("lets anyone toggle when no tags are required", () => {
            expect(canToggleAreaLock(makeArea([ephemeralLock]), [], "user-1")).toBe(true);
        });

        it("requires a matching tag when allowedTags is set", () => {
            expect(canToggleAreaLock(makeArea([restrictedEphemeralLock]), ["admin"], "user-1")).toBe(true);
            expect(canToggleAreaLock(makeArea([restrictedEphemeralLock]), ["member"], "user-1")).toBe(false);
        });
    });

    it("denies when the area has no lockable property", () => {
        expect(canToggleAreaLock(makeArea([personalArea("user-42")]), [], "user-42")).toBe(false);
    });
});

describe("locked-area bubble separation", () => {
    const makeArea = (id: string, x: number, y: number, width: number, height: number): AreaData =>
        AreaData.parse({
            id,
            x,
            y,
            width,
            height,
            visible: true,
            name: id,
            properties: [{ id: `lock-${id}`, type: "lockableAreaPropertyData" }],
        });

    const room = makeArea("room", 100, 100, 200, 150);

    describe("isPositionInsideArea", () => {
        it("detects inside and outside positions", () => {
            expect(isPositionInsideArea({ x: 150, y: 150 }, room)).toBe(true);
            expect(isPositionInsideArea({ x: 50, y: 150 }, room)).toBe(false);
            // Boundaries: the top-left edge is inside, the bottom-right edge is not.
            expect(isPositionInsideArea({ x: 100, y: 100 }, room)).toBe(true);
            expect(isPositionInsideArea({ x: 300, y: 250 }, room)).toBe(false);
        });
    });

    describe("arePositionsSeparatedByLockedArea", () => {
        const locked = () => true;
        const unlocked = () => false;
        const inside = { x: 150, y: 150 };
        const outside = { x: 310, y: 150 };
        const alsoInside = { x: 250, y: 200 };
        const alsoOutside = { x: 400, y: 400 };

        it("separates an inside position from an outside one when the area is locked", () => {
            expect(arePositionsSeparatedByLockedArea([room], locked, inside, outside)).toBe(true);
        });

        it("does not separate two insiders (they keep bubbling together)", () => {
            expect(arePositionsSeparatedByLockedArea([room], locked, inside, alsoInside)).toBe(false);
        });

        it("does not separate two outsiders", () => {
            expect(arePositionsSeparatedByLockedArea([room], locked, outside, alsoOutside)).toBe(false);
        });

        it("does not separate across an unlocked area", () => {
            expect(arePositionsSeparatedByLockedArea([room], unlocked, inside, outside)).toBe(false);
        });

        it("handles maps with no areas", () => {
            expect(arePositionsSeparatedByLockedArea([], locked, inside, outside)).toBe(false);
        });
    });
});

describe("hasEffectiveOwnerLock", () => {
    const makeArea = (properties: unknown[]): AreaData =>
        AreaData.parse({
            id: "area-1",
            x: 0,
            y: 0,
            width: 64,
            height: 64,
            visible: true,
            name: "office",
            properties,
        });

    const ownerLock = { id: "lock-1", type: "lockableAreaPropertyData", lockMode: "owner" };
    const ephemeralLock = { id: "lock-1", type: "lockableAreaPropertyData", lockMode: "ephemeral" };
    const personalArea = (ownerId: string | null) => ({
        id: "personal-1",
        type: "personalAreaPropertyData",
        accessClaimMode: "dynamic",
        ownerId,
    });

    it("is effective when the owner lock is backed by a claimed owner", () => {
        expect(hasEffectiveOwnerLock(makeArea([ownerLock, personalArea("user-42")]))).toBe(true);
    });

    it("degrades when there is no personal area", () => {
        expect(hasEffectiveOwnerLock(makeArea([ownerLock]))).toBe(false);
    });

    it("degrades when the personal area is unclaimed (ownerId null)", () => {
        expect(hasEffectiveOwnerLock(makeArea([ownerLock, personalArea(null)]))).toBe(false);
    });

    it("is never effective for ephemeral locks", () => {
        expect(hasEffectiveOwnerLock(makeArea([ephemeralLock, personalArea("user-42")]))).toBe(false);
    });
});

describe("canPassAreaLock", () => {
    const makeArea = (properties: unknown[]): AreaData =>
        AreaData.parse({
            id: "area-1",
            x: 0,
            y: 0,
            width: 64,
            height: 64,
            visible: true,
            name: "office",
            properties,
        });

    const ownerLock = { id: "lock-1", type: "lockableAreaPropertyData", lockMode: "owner" };
    const ephemeralLock = { id: "lock-1", type: "lockableAreaPropertyData", lockMode: "ephemeral" };
    const personalArea = (ownerId: string | null) => ({
        id: "personal-1",
        type: "personalAreaPropertyData",
        accessClaimMode: "dynamic",
        ownerId,
    });

    it("lets the owner pass through their own owner lock (leave and re-enter freely)", () => {
        expect(canPassAreaLock(makeArea([ownerLock, personalArea("user-42")]), "user-42")).toBe(true);
    });

    it("blocks a non-owner", () => {
        expect(canPassAreaLock(makeArea([ownerLock, personalArea("user-42")]), "user-99")).toBe(false);
    });

    it("blocks an anonymous user", () => {
        expect(canPassAreaLock(makeArea([ownerLock, personalArea("user-42")]), undefined)).toBe(false);
    });

    it("does not apply to ephemeral locks (legacy behaviour: nobody passes)", () => {
        expect(canPassAreaLock(makeArea([ephemeralLock, personalArea("user-42")]), "user-42")).toBe(false);
    });

    it("does not apply when the owner lock has no claimed owner", () => {
        expect(canPassAreaLock(makeArea([ownerLock, personalArea(null)]), "user-42")).toBe(false);
        expect(canPassAreaLock(makeArea([ownerLock]), "user-42")).toBe(false);
    });
});

describe("canEjectFromArea", () => {
    const makeArea = (properties: unknown[]): AreaData =>
        AreaData.parse({
            id: "area-1",
            x: 0,
            y: 0,
            width: 64,
            height: 64,
            visible: true,
            name: "office",
            properties,
        });

    const personalArea = (ownerId: string | null) => ({
        id: "personal-1",
        type: "personalAreaPropertyData",
        accessClaimMode: "dynamic",
        ownerId,
    });
    const lockable = (ownerCanEject?: boolean) => ({
        id: "lock-1",
        type: "lockableAreaPropertyData",
        ...(ownerCanEject !== undefined ? { ownerCanEject } : {}),
    });

    it("lets the owner eject by default (no flag set)", () => {
        expect(canEjectFromArea(makeArea([personalArea("user-42"), lockable()]), "user-42")).toBe(true);
    });

    it("lets the owner eject when there is no lockable property to block it", () => {
        expect(canEjectFromArea(makeArea([personalArea("user-42")]), "user-42")).toBe(true);
    });

    it("blocks ejection when an admin set ownerCanEject to false", () => {
        expect(canEjectFromArea(makeArea([personalArea("user-42"), lockable(false)]), "user-42")).toBe(false);
    });

    it("allows ejection when ownerCanEject is explicitly true", () => {
        expect(canEjectFromArea(makeArea([personalArea("user-42"), lockable(true)]), "user-42")).toBe(true);
    });

    it("denies a non-owner", () => {
        expect(canEjectFromArea(makeArea([personalArea("user-42"), lockable()]), "user-99")).toBe(false);
    });

    it("denies an anonymous user", () => {
        expect(canEjectFromArea(makeArea([personalArea("user-42"), lockable()]), undefined)).toBe(false);
    });

    it("denies when the area has no owner (no personal area)", () => {
        expect(canEjectFromArea(makeArea([lockable()]), "user-42")).toBe(false);
    });

    it("denies when the personal area is unclaimed (ownerId null)", () => {
        expect(canEjectFromArea(makeArea([personalArea(null), lockable()]), "user-42")).toBe(false);
    });
});

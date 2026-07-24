import { describe, expect, it } from "vitest";
import { AreaData, LockableAreaPropertyData } from "../src/types";
import { isAreaOwnerLockValid } from "../src/Utils";

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
        expect(parsed.doorGapTiles).toBe(2);
        expect(parsed.gracePeriodSeconds).toBe(300);
    });

    it("accepts the owner lock mode", () => {
        const parsed = LockableAreaPropertyData.parse({ ...baseLockable, lockMode: "owner" });

        expect(parsed.lockMode).toBe("owner");
    });

    it("rejects an unknown lock mode", () => {
        expect(() => LockableAreaPropertyData.parse({ ...baseLockable, lockMode: "public" })).toThrow();
    });

    it("caps the grace period at 5 minutes (300s)", () => {
        expect(LockableAreaPropertyData.parse({ ...baseLockable, gracePeriodSeconds: 300 }).gracePeriodSeconds).toBe(
            300,
        );
        expect(() => LockableAreaPropertyData.parse({ ...baseLockable, gracePeriodSeconds: 301 })).toThrow();
    });

    it("requires a door gap of at least one tile", () => {
        expect(() => LockableAreaPropertyData.parse({ ...baseLockable, doorGapTiles: 0 })).toThrow();
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

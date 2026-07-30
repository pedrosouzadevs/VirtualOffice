import type { AreaData } from "@workadventure/map-editor";
import { Subject } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import type { AreaZoneTracker } from "../src/Model/AreaZoneTracker";
import type { GameRoom } from "../src/Model/GameRoom";
import { LockableAreaManager } from "../src/Model/AreaPropertyEvents/LockableAreaManager";

type LockMode = "ephemeral" | "owner";

function createArea(areaId: string, lockMode: LockMode | undefined, ownerId?: string | null): AreaData {
    const properties: AreaData["properties"][number][] = [
        {
            id: `property-${areaId}`,
            type: "lockableAreaPropertyData",
            allowedTags: [],
            ...(lockMode !== undefined ? { lockMode } : {}),
        } as AreaData["properties"][number],
    ];

    if (ownerId !== undefined) {
        properties.push({
            id: `personal-${areaId}`,
            type: "personalAreaPropertyData",
            accessClaimMode: "dynamic",
            allowedTags: [],
            ownerId,
        } as AreaData["properties"][number]);
    }

    return {
        id: areaId,
        name: `Area ${areaId}`,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        visible: true,
        properties,
    };
}

function createHarness(): {
    enterSubject: Subject<AreaData>;
    leaveSubject: Subject<AreaData>;
    destroySubject: Subject<void>;
    setAreaPropertyVariable: ReturnType<typeof vi.fn>;
    registerEventListener: ReturnType<typeof vi.fn>;
} {
    const enterSubject = new Subject<AreaData>();
    const leaveSubject = new Subject<AreaData>();
    const destroySubject = new Subject<void>();

    const registerEventListener = vi.fn((eventType: "enter" | "leave") => {
        return eventType === "enter" ? enterSubject.asObservable() : leaveSubject.asObservable();
    });
    const areaZoneTracker = {
        registerEventListener,
    } as unknown as AreaZoneTracker;

    const setAreaPropertyVariable = vi.fn();
    const gameRoom = {
        setAreaPropertyVariable,
        destroyRoomStream: destroySubject.asObservable(),
    } as unknown as GameRoom;

    new LockableAreaManager(gameRoom, areaZoneTracker);

    return { enterSubject, leaveSubject, destroySubject, setAreaPropertyVariable, registerEventListener };
}

describe("LockableAreaManager", () => {
    // Backward-compat guarantee: the legacy ephemeral lock must still auto-unlock on empty.
    it("unlocks an ephemeral area when the last user leaves", () => {
        const { enterSubject, leaveSubject, setAreaPropertyVariable } = createHarness();
        const area = createArea("area-1", "ephemeral");

        enterSubject.next(area);
        expect(setAreaPropertyVariable).not.toHaveBeenCalled();

        leaveSubject.next(area);
        expect(setAreaPropertyVariable).toHaveBeenCalledTimes(1);
        expect(setAreaPropertyVariable).toHaveBeenCalledWith("area-1", "property-area-1", "lock", "false");
    });

    // Older maps have no lockMode; the schema default makes them ephemeral, so behaviour is unchanged.
    it("treats a missing lockMode as ephemeral and unlocks on empty", () => {
        const { enterSubject, leaveSubject, setAreaPropertyVariable } = createHarness();
        const area = createArea("area-legacy", undefined);

        enterSubject.next(area);
        leaveSubject.next(area);

        expect(setAreaPropertyVariable).toHaveBeenCalledWith("area-legacy", "property-area-legacy", "lock", "false");
    });

    // Core new behaviour: an owner lock (backed by a claimed owner) is persistent and must NOT
    // auto-unlock when empty.
    it("keeps an owner-locked area locked when the last user leaves", () => {
        const { enterSubject, leaveSubject, setAreaPropertyVariable } = createHarness();
        const area = createArea("area-owner", "owner", "user-42");

        enterSubject.next(area);
        leaveSubject.next(area);

        expect(setAreaPropertyVariable).not.toHaveBeenCalled();
    });

    // An owner lock with no claimed owner degrades to ephemeral: without this, the area could
    // stay locked forever with nobody able to unlock it.
    it("auto-unlocks an owner-locked area with no personal area (degrades to ephemeral)", () => {
        const { enterSubject, leaveSubject, setAreaPropertyVariable } = createHarness();
        const area = createArea("area-noowner", "owner");

        enterSubject.next(area);
        leaveSubject.next(area);

        expect(setAreaPropertyVariable).toHaveBeenCalledWith("area-noowner", "property-area-noowner", "lock", "false");
    });

    it("auto-unlocks an owner-locked area whose personal area is unclaimed (ownerId null)", () => {
        const { enterSubject, leaveSubject, setAreaPropertyVariable } = createHarness();
        const area = createArea("area-unclaimed", "owner", null);

        enterSubject.next(area);
        leaveSubject.next(area);

        expect(setAreaPropertyVariable).toHaveBeenCalledWith(
            "area-unclaimed",
            "property-area-unclaimed",
            "lock",
            "false",
        );
    });

    it("only unlocks an ephemeral area once the last of several users leaves", () => {
        const { enterSubject, leaveSubject, setAreaPropertyVariable } = createHarness();
        const area = createArea("area-1", "ephemeral");

        enterSubject.next(area);
        enterSubject.next(area);

        leaveSubject.next(area);
        expect(setAreaPropertyVariable).not.toHaveBeenCalled();

        leaveSubject.next(area);
        expect(setAreaPropertyVariable).toHaveBeenCalledTimes(1);
        expect(setAreaPropertyVariable).toHaveBeenCalledWith("area-1", "property-area-1", "lock", "false");
    });

    it("unsubscribes on room destroy", () => {
        const { enterSubject, leaveSubject, destroySubject, setAreaPropertyVariable, registerEventListener } =
            createHarness();
        const area = createArea("area-1", "ephemeral");

        expect(registerEventListener).toHaveBeenNthCalledWith(1, "enter", "lockableAreaPropertyData");
        expect(registerEventListener).toHaveBeenNthCalledWith(2, "leave", "lockableAreaPropertyData");

        destroySubject.next();
        enterSubject.next(area);
        leaveSubject.next(area);

        expect(setAreaPropertyVariable).not.toHaveBeenCalled();
    });
});

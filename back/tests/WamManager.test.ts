import { describe, expect, it } from "vitest";
import type { EditMapCommandMessage } from "@workadventure/messages";
import type { WAMFileFormat } from "@workadventure/map-editor";
import { WamManager } from "../src/Model/Services/WamManager";

function createInitialWam(): WAMFileFormat {
    return {
        version: "1",
        mapUrl: "https://example.com/maps/test.tmj",
        entities: {},
        areas: [
            {
                id: "area-1",
                name: "Area 1",
                x: 0,
                y: 0,
                width: 10,
                height: 10,
                visible: true,
                properties: [
                    {
                        id: "lock-1",
                        type: "lockableAreaPropertyData",
                        allowedTags: ["admin"],
                        lockMode: "ephemeral",
                    },
                ],
            },
        ],
        entityCollections: [],
        settings: {},
    };
}

describe("WamManager", () => {
    it("applies createArea and updateWAMSettings commands", async () => {
        const manager = new WamManager(createInitialWam());

        const createAreaCommand: EditMapCommandMessage = {
            id: "cmd-create-area",
            editMapMessage: {
                message: {
                    $case: "createAreaMessage",
                    createAreaMessage: {
                        id: "area-2",
                        name: "Area 2",
                        x: 100,
                        y: 200,
                        width: 20,
                        height: 30,
                        properties: [],
                    },
                },
            },
        };

        const updateSettingsCommand: EditMapCommandMessage = {
            id: "cmd-update-settings",
            editMapMessage: {
                message: {
                    $case: "updateWAMSettingsMessage",
                    updateWAMSettingsMessage: {
                        message: {
                            $case: "updateRecordingSettingMessage",
                            updateRecordingSettingMessage: {
                                settings: {
                                    rights: ["admin"],
                                },
                            },
                        },
                    },
                },
            },
        };

        await manager.applyCommand(createAreaCommand);
        await manager.applyCommand(updateSettingsCommand);

        const wam = manager.getWam();
        expect(wam).toBeDefined();
        expect(wam?.areas.find((area) => area.id === "area-2")?.visible).toBe(true);
        expect(wam?.settings?.recording?.rights).toEqual(["admin"]);
        expect(wam?.lastCommandId).toBe("cmd-update-settings");
    });

    it("applies setTiles and clearTileOverlay commands to its WAM mirror", async () => {
        // The back keeps its own WAM copy in sync by replaying every edit command (ADR-0007). If these two
        // cases fell out of the switch, the mirror would silently drift from what map-storage persisted.
        const manager = new WamManager(createInitialWam());

        await manager.applyCommand({
            id: "cmd-set-tiles",
            editMapMessage: {
                message: {
                    $case: "setTilesMessage",
                    setTilesMessage: {
                        tiles: [
                            { x: 1, y: 2, layerName: "walls1", gid: 42 },
                            { x: 1, y: 3, layerName: "collisions", gid: 3 },
                            { x: 5, y: 6, layerName: "walls1", gid: 0 },
                        ],
                    },
                },
            },
        });

        let wam = manager.getWam();
        expect(wam?.tileOverlay).toEqual({
            layers: { walls1: { "1,2": 42, "5,6": 0 }, collisions: { "1,3": 3 } },
        });
        expect(wam?.lastCommandId).toBe("cmd-set-tiles");

        await manager.applyCommand({
            id: "cmd-clear-overlay",
            editMapMessage: {
                message: { $case: "clearTileOverlayMessage", clearTileOverlayMessage: {} },
            },
        });

        wam = manager.getWam();
        expect(wam?.tileOverlay).toBeUndefined();
        expect(wam?.lastCommandId).toBe("cmd-clear-overlay");
    });

    it("preserves area properties when modifyProperties is false", async () => {
        const manager = new WamManager(createInitialWam());

        const modifyAreaCommand: EditMapCommandMessage = {
            id: "cmd-modify-area",
            editMapMessage: {
                message: {
                    $case: "modifyAreaMessage",
                    modifyAreaMessage: {
                        id: "area-1",
                        x: 42,
                        y: 24,
                        properties: [],
                        modifyProperties: false,
                    },
                },
            },
        };

        await manager.applyCommand(modifyAreaCommand);

        const wam = manager.getWam();
        const area = wam?.areas.find((candidate) => candidate.id === "area-1");
        expect(area?.x).toBe(42);
        expect(area?.y).toBe(24);
        expect(area?.properties).toHaveLength(1);
        expect(area?.properties[0]?.id).toBe("lock-1");
    });
});

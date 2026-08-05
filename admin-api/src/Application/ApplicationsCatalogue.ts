import type { ApplicationDefinitionInterface } from "@workadventure/messages";

/** One toggle per integration, mirroring the `*_ENABLED` environment variables `play` reads. */
export interface ApplicationToggles {
    klaxoon: boolean;
    youtube: boolean;
    googleDrive: boolean;
    googleDocs: boolean;
    googleSheets: boolean;
    googleSlides: boolean;
    eraser: boolean;
    excalidraw: boolean;
    cards: boolean;
    tldraw: boolean;
}

type ApplicationDefinition = Omit<ApplicationDefinitionInterface, "enabled" | "default" | "forceNewTab" | "allowAPI">;

/**
 * Definitions copied verbatim from `LocalAdmin.fetchMemberDataByUuid`, in the same order.
 *
 * Order matters: the front renders these as a list, so reshuffling them would visibly rearrange the user's menu the
 * day the Admin API is switched on.
 */
const DEFINITIONS: ReadonlyArray<{ toggle: keyof ApplicationToggles; definition: ApplicationDefinition }> = [
    {
        toggle: "klaxoon",
        definition: {
            name: "Klaxoon",
            doc: "https://klaxoon.com",
            image: "https://static.klaxoon.com/favicon.ico",
            description: "Klaxoon (Brainstorming, Quiz, Survey)",
        },
    },
    {
        toggle: "youtube",
        definition: {
            name: "Youtube",
            doc: "https://youtube.com",
            image: "https://www.youtube.com/favicon.ico",
            description: "Youtube (Video sharing)",
        },
    },
    {
        toggle: "googleDrive",
        definition: {
            name: "Google Drive",
            doc: "https://drive.google.com",
            description: "Google Drive (Docs, Sheets, Slides)",
        },
    },
    {
        toggle: "googleDocs",
        definition: {
            name: "Google Docs",
            doc: "https://docs.google.com",
            description: "Google Docs (Word Processor)",
        },
    },
    {
        toggle: "googleSheets",
        definition: {
            name: "Google Sheets",
            doc: "https://sheets.google.com",
            description: "Google Sheets (Spreadsheet)",
        },
    },
    {
        toggle: "googleSlides",
        definition: {
            name: "Google Slides",
            doc: "https://slides.google.com",
            description: "Google Slides (Presentation)",
        },
    },
    {
        toggle: "eraser",
        definition: { name: "Eraser", doc: "https://workadventu.re", description: "Eraser (White board)" },
    },
    {
        toggle: "excalidraw",
        definition: { name: "Excalidraw", doc: "https://excalidraw.com", description: "Excalidraw (White board)" },
    },
    {
        toggle: "cards",
        definition: { name: "Cards", doc: "https://workadventu.re", description: "Cards (learning tool)" },
    },
    {
        toggle: "tldraw",
        definition: { name: "tldraw", doc: "https://tldraw.com", description: "tldraw (White board)" },
    },
];

/**
 * Builds the `applications` array returned by `/api/room/access`.
 *
 * Only enabled integrations appear at all — `LocalAdmin` pushes nothing for a disabled one rather than pushing it
 * with `enabled: false`, and the front counts entries.
 */
export function buildApplications(toggles: ApplicationToggles): ApplicationDefinitionInterface[] {
    return DEFINITIONS.filter(({ toggle }) => toggles[toggle]).map(({ definition }) => ({
        ...definition,
        enabled: true,
        default: true,
        forceNewTab: false,
        allowAPI: false,
    }));
}

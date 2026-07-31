import type { Express } from "express";
import type { MapDetailsConfiguration } from "../../src/Application/MapDetailsService";
import type { MemberRepository } from "../../src/Application/Ports/MemberRepository";
import type { TagRepository } from "../../src/Application/Ports/TagRepository";
import type { RoomAccessConfiguration } from "../../src/Application/RoomAccessService";
import { normalizeEmail, type Member, type MemberSummary } from "../../src/Domain/Member";
import { createServer, type ServerDependencies } from "../../src/api/server";
import { startTestServer, type TestServer } from "./testServer";

/** Any non-empty value works; tests assert on matching versus not matching, never on the value itself. */
export const TEST_ADMIN_API_TOKEN = "test-admin-api-token";

/**
 * Mirrors the defaults a bare `.env` produces, so a test that cares about one flag only has to override that flag.
 */
export const TEST_MAP_DETAILS_CONFIGURATION: MapDetailsConfiguration = {
    startRoomUrl: "/_/global/maps.workadventu.re/starter/map.json",
    publicMapStorageUrl: "http://map-storage.workadventure.localhost",
    disableAnonymous: false,
    enableChat: true,
    enableChatUpload: true,
    enableChatOnlineList: true,
    enableChatDisconnectedList: true,
    enableSay: true,
    enableIssueReport: true,
    enableTutorial: true,
    skipCameraPage: false,
    bypassPwa: false,
    defaultWokaName: undefined,
    defaultWokaTexture: undefined,
    provideDefaultWokaName: undefined,
    provideDefaultWokaTexture: undefined,
    opidWokaNamePolicy: "user_input",
    matrixChatConfigured: false,
    recordingConfigured: false,
};

export const TEST_ROOM_ACCESS_CONFIGURATION: RoomAccessConfiguration = {
    enableMapEditor: true,
    worldName: "localWorld",
    recordingConfigured: false,
    applications: [],
};

/**
 * Minimal repository stub: the tests that matter here are about the HTTP contract and the tag rules, not about SQL.
 * The database behaviour is covered against a real Postgres in `tests/integration`.
 */
export class StubMemberRepository implements MemberRepository {
    constructor(private readonly known: readonly Member[] = []) {}

    findByEmail(email: string): Promise<Member | undefined> {
        return Promise.resolve(this.known.find((member) => member.email === normalizeEmail(email)));
    }

    search(searchText: string, limit: number): Promise<MemberSummary[]> {
        const needle = searchText.trim().toLowerCase();
        if (needle === "") {
            return Promise.resolve([]);
        }

        return Promise.resolve(
            this.known
                .filter(
                    (member) =>
                        member.email.includes(needle) || (member.username?.toLowerCase().includes(needle) ?? false),
                )
                .slice(0, limit),
        );
    }

    ensureMember(): Promise<Member> {
        return Promise.reject(new Error("Not needed by these tests."));
    }

    ensureTag(): Promise<{ id: string; name: string }> {
        return Promise.reject(new Error("Not needed by these tests."));
    }

    grantTag(): Promise<void> {
        return Promise.reject(new Error("Not needed by these tests."));
    }
}

export class StubTagRepository implements TagRepository {
    constructor(private readonly known: readonly string[] = []) {}

    search(searchText: string, limit: number): Promise<string[]> {
        const needle = searchText.trim().toLowerCase();
        const matched = needle === "" ? this.known : this.known.filter((name) => name.toLowerCase().includes(needle));

        return Promise.resolve(
            matched
                .slice()
                .sort((a, b) => a.localeCompare(b))
                .slice(0, limit),
        );
    }

    listAll(): Promise<string[]> {
        return Promise.resolve(this.known.slice().sort((a, b) => a.localeCompare(b)));
    }
}

/** Builds a member with sensible defaults so a test only states what it cares about. */
export function testMember(email: string, tags: string[] = [], username: string | null = null): Member {
    return { id: `id-${email}`, email: normalizeEmail(email), oidcSub: null, username, tags };
}

/**
 * Servers started by the current test file, torn down by {@link closeStartedServers}.
 *
 * Tracked in an array rather than a reassigned variable so a test may start more than one, and so teardown never
 * reassigns shared state across an `await` boundary.
 */
const started: TestServer[] = [];

/**
 * Builds the real application with test defaults and serves it on an ephemeral port.
 *
 * @returns the base URL of the running server.
 */
export async function serveTestApp(overrides: Partial<ServerDependencies> = {}): Promise<string> {
    const app: Express = createServer({
        adminApiToken: TEST_ADMIN_API_TOKEN,
        mapDetailsConfiguration: TEST_MAP_DETAILS_CONFIGURATION,
        roomAccessConfiguration: TEST_ROOM_ACCESS_CONFIGURATION,
        memberRepository: new StubMemberRepository(),
        tagRepository: new StubTagRepository(),
        ...overrides,
    });
    const server = await startTestServer(app);
    started.push(server);

    return server.url;
}

export async function closeStartedServers(): Promise<void> {
    await Promise.all(started.splice(0).map((server) => server.close()));
}

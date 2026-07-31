import type { Express, RequestHandler } from "express";
import type { MapDetailsConfiguration } from "../../src/Application/MapDetailsService";
import type { MemberRepository } from "../../src/Application/Ports/MemberRepository";
import type { TagRepository } from "../../src/Application/Ports/TagRepository";
import type { RoomAccessConfiguration } from "../../src/Application/RoomAccessService";
import { normalizeEmail, type Member, type MemberSummary } from "../../src/Domain/Member";
import { createServer, type ServerDependencies } from "../../src/api/server";
import { StubOidcAuthenticator, TEST_DASHBOARD_CONFIGURATION } from "./adminDashboard";
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
    constructor(private known: readonly Member[] = []) {}

    /**
     * Replaces the whole set mid-test.
     *
     * The point is ADR-0004's mandatory test #4: revoking the `admin` tag has to deny the *next* request on a session
     * that is already open, which cannot be shown without changing the database under a live cookie.
     */
    replaceAll(members: readonly Member[]): void {
        this.known = members;
    }

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

    listAll(): Promise<Member[]> {
        return Promise.resolve([...this.known]);
    }

    revokeTag(): Promise<void> {
        return Promise.reject(new Error("Not needed by these tests."));
    }

    setUsername(): Promise<Member | undefined> {
        return Promise.reject(new Error("Not needed by these tests."));
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

    findByName(name: string): Promise<{ id: string; name: string } | undefined> {
        return Promise.resolve(this.known.includes(name) ? { id: `tag-${name}`, name } : undefined);
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

/** The app with the dashboard mounted, plus handles on everything a test may need to move under it. */
export interface DashboardTestApp {
    readonly url: string;
    /** Mutate with `replaceAll` to revoke a tag while a session is open. */
    readonly members: StubMemberRepository;
    readonly authenticator: StubOidcAuthenticator;
    /** Moves the server's clock, which is how expiry and renewal are exercised without waiting. */
    setNow(now: Date): void;
}

/**
 * Serves the real application with `/admin` enabled.
 *
 * The identity provider is stubbed and the clock is injectable; everything else — the barrier, the cookies, the CSRF
 * check, the 404 and error handlers — is the production wiring, because that is what the mandatory tests are about.
 */
export async function serveDashboardTestApp(
    options: {
        members?: readonly Member[];
        /** Email the stub provider will authenticate as. */
        loginAs?: string;
        now?: Date;
        rateLimit?: RequestHandler;
    } = {},
): Promise<DashboardTestApp> {
    const members = new StubMemberRepository(options.members ?? []);
    const authenticator = new StubOidcAuthenticator(options.loginAs ?? "john.doe@example.com");
    let now = options.now ?? new Date();

    const url = await serveTestApp({
        memberRepository: members,
        adminDashboard: {
            configuration: TEST_DASHBOARD_CONFIGURATION,
            authenticator,
            now: () => now,
            rateLimit: options.rateLimit,
        },
    });

    return {
        url,
        members,
        authenticator,
        setNow: (value: Date) => {
            now = value;
        },
    };
}

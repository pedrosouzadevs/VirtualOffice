import type { Express, RequestHandler } from "express";
import type { MapDetailsConfiguration } from "../../src/Application/MapDetailsService";
import type { AuditLogRepository } from "../../src/Application/Ports/AuditLogRepository";
import type { AuditEntry, RecordedAuditEntry } from "../../src/Domain/AuditEntry";
import type { MemberRepository } from "../../src/Application/Ports/MemberRepository";
import type { RoomCatalogue } from "../../src/Application/Ports/RoomCatalogue";
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
 * The tag table, in memory.
 *
 * Shared between the two repository stubs on purpose: granting a tag goes through `MemberRepository.ensureTag` while
 * revoking looks it up through `TagRepository.findByName`, so two separate catalogues would make every
 * grant-then-revoke test pass for the wrong reason.
 */
export class TagCatalogue {
    private readonly byName = new Map<string, { id: string; name: string }>();

    constructor(names: readonly string[] = []) {
        for (const name of names) {
            this.ensure(name);
        }
    }

    ensure(name: string): { id: string; name: string } {
        const existing = this.byName.get(name);
        if (existing !== undefined) {
            return existing;
        }

        const created = { id: `tag-${name}`, name };
        this.byName.set(name, created);

        return created;
    }

    find(name: string): { id: string; name: string } | undefined {
        return this.byName.get(name);
    }

    findById(id: string): { id: string; name: string } | undefined {
        return [...this.byName.values()].find((tag) => tag.id === id);
    }

    names(): string[] {
        return [...this.byName.keys()];
    }
}

/**
 * The member store, in memory: the tests here are about the HTTP contract and the tag rules, not about SQL. The
 * database behaviour is covered against a real Postgres in `tests/integration`.
 *
 * The mutations are implemented rather than stubbed out, because G1's endpoints are mutations and a test that cannot
 * observe the effect of a grant proves nothing.
 */
export class StubMemberRepository implements MemberRepository {
    private members: Member[];

    constructor(
        known: readonly Member[] = [],
        private readonly catalogue: TagCatalogue = new TagCatalogue(),
    ) {
        this.members = [...known];
        this.registerSeededTags();
    }

    /**
     * Replaces the whole set mid-test.
     *
     * The point is ADR-0004's mandatory test #4: revoking the `admin` tag has to deny the *next* request on a session
     * that is already open, which cannot be shown without changing the database under a live cookie.
     */
    replaceAll(members: readonly Member[]): void {
        this.members = [...members];
        this.registerSeededTags();
    }

    /** A tag a seeded member already holds must exist in the catalogue, or revoking it would answer "not found". */
    private registerSeededTags(): void {
        for (const member of this.members) {
            for (const name of member.tags) {
                this.catalogue.ensure(name);
            }
        }
    }

    private replace(updated: Member): Member {
        this.members = this.members.map((member) => (member.id === updated.id ? updated : member));

        return updated;
    }

    findByEmail(email: string): Promise<Member | undefined> {
        return Promise.resolve(this.members.find((member) => member.email === normalizeEmail(email)));
    }

    search(searchText: string, limit: number): Promise<MemberSummary[]> {
        return Promise.resolve(this.matching(searchText).slice(0, limit));
    }

    searchWithTags(searchText: string, limit: number): Promise<Member[]> {
        return Promise.resolve(this.matching(searchText).slice(0, limit));
    }

    /** Shared so the two searches cannot disagree about what matches, exactly as the SQL ones share their query. */
    private matching(searchText: string): Member[] {
        const needle = searchText.trim().toLowerCase();
        if (needle === "") {
            return [];
        }

        return this.members.filter(
            (member) => member.email.includes(needle) || (member.username?.toLowerCase().includes(needle) ?? false),
        );
    }

    listAll(limit = Number.MAX_SAFE_INTEGER): Promise<Member[]> {
        return Promise.resolve([...this.members].sort((a, b) => a.email.localeCompare(b.email)).slice(0, limit));
    }

    ensureMember(email: string, username?: string): Promise<Member> {
        const normalized = normalizeEmail(email);
        const existing = this.members.find((member) => member.email === normalized);

        if (existing !== undefined) {
            return Promise.resolve(existing);
        }

        // A member who has never logged in is a meaningful person to prepare access for, so granting creates them.
        const created: Member = {
            id: `id-${normalized}`,
            email: normalized,
            oidcSub: null,
            username: username ?? null,
            tags: [],
        };
        this.members.push(created);

        return Promise.resolve(created);
    }

    ensureTag(name: string): Promise<{ id: string; name: string }> {
        return Promise.resolve(this.catalogue.ensure(name));
    }

    grantTag(memberId: string, tagId: string): Promise<void> {
        const member = this.members.find((entry) => entry.id === memberId);
        const tag = this.catalogue.findById(tagId);

        if (member !== undefined && tag !== undefined && !member.tags.includes(tag.name)) {
            this.replace({ ...member, tags: [...member.tags, tag.name] });
        }

        return Promise.resolve();
    }

    revokeTag(memberId: string, tagId: string): Promise<void> {
        const member = this.members.find((entry) => entry.id === memberId);
        const tag = this.catalogue.findById(tagId);

        if (member !== undefined && tag !== undefined) {
            this.replace({ ...member, tags: member.tags.filter((name) => name !== tag.name) });
        }

        return Promise.resolve();
    }

    setUsername(email: string, username: string | null): Promise<Member | undefined> {
        const member = this.members.find((entry) => entry.email === normalizeEmail(email));

        return Promise.resolve(member === undefined ? undefined : this.replace({ ...member, username }));
    }
}

/**
 * The audit log, in memory.
 *
 * Implemented rather than stubbed out, because ADR-0004's mandatory test #6 is precisely "every mutation writes an
 * entry naming the actor" — a fake that swallowed the writes would prove the opposite of what is needed.
 */
export class StubAuditLogRepository implements AuditLogRepository {
    readonly entries: RecordedAuditEntry[] = [];

    /** Set to make writes fail, standing in for a database in trouble. */
    failing = false;

    record(entry: AuditEntry): Promise<void> {
        if (this.failing) {
            return Promise.reject(new Error("The audit log is unavailable."));
        }

        this.entries.push({
            ...entry,
            id: `audit-${this.entries.length}`,
            // Ordered by insertion rather than by a real clock, which keeps assertions on ordering deterministic.
            createdAt: new Date(Date.UTC(2026, 6, 31, 9, 0, this.entries.length)),
        });

        return Promise.resolve();
    }

    listRecent(limit: number): Promise<RecordedAuditEntry[]> {
        return Promise.resolve([...this.entries].reverse().slice(0, limit));
    }

    listForTarget(targetEmail: string, limit: number): Promise<RecordedAuditEntry[]> {
        return Promise.resolve(
            [...this.entries]
                .reverse()
                .filter((entry) => entry.targetEmail === normalizeEmail(targetEmail))
                .slice(0, limit),
        );
    }
}

export class StubTagRepository implements TagRepository {
    private readonly catalogue: TagCatalogue;

    /** Accepts a bare list for the read-only tests, or a shared catalogue when mutations have to be observed. */
    constructor(source: readonly string[] | TagCatalogue = []) {
        this.catalogue = source instanceof TagCatalogue ? source : new TagCatalogue(source);
    }

    search(searchText: string, limit: number): Promise<string[]> {
        const needle = searchText.trim().toLowerCase();
        const known = this.catalogue.names();
        const matched = needle === "" ? known : known.filter((name) => name.toLowerCase().includes(needle));

        return Promise.resolve(matched.sort((a, b) => a.localeCompare(b)).slice(0, limit));
    }

    listAll(): Promise<string[]> {
        return Promise.resolve(this.catalogue.names().sort((a, b) => a.localeCompare(b)));
    }

    findByName(name: string): Promise<{ id: string; name: string } | undefined> {
        return Promise.resolve(this.catalogue.find(name));
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
    readonly tags: StubTagRepository;
    /** Inspect `entries` to assert what a mutation recorded. */
    readonly audit: StubAuditLogRepository;
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
        /** Tags that exist before the test starts. Tags a seeded member holds are registered automatically. */
        tags?: readonly string[];
        /** Email the stub provider will authenticate as. */
        loginAs?: string;
        now?: Date;
        rateLimit?: RequestHandler;
        /** A stand-in for `dist-ui`. Omitted means "the dashboard was never built", which must also work. */
        uiDirectory?: string;
        /** Omitted means `INTERNAL_MAP_STORAGE_URL` is unset, which the rooms screen must report distinctly. */
        rooms?: RoomCatalogue;
    } = {},
): Promise<DashboardTestApp> {
    // One catalogue behind both repositories: a tag created by a grant must be findable by the revoke that follows.
    const catalogue = new TagCatalogue(options.tags ?? []);
    const members = new StubMemberRepository(options.members ?? [], catalogue);
    const tags = new StubTagRepository(catalogue);
    const audit = new StubAuditLogRepository();
    const authenticator = new StubOidcAuthenticator(options.loginAs ?? "john.doe@example.com");
    let now = options.now ?? new Date();

    const url = await serveTestApp({
        memberRepository: members,
        tagRepository: tags,
        // A path that cannot exist, so the "not built" branch is what runs unless a test asks otherwise. Falling back
        // to the real `dist-ui` would make these tests depend on whether somebody had run the build.
        dashboardUiDirectory: options.uiDirectory ?? "/nonexistent-dashboard-build",
        adminDashboard: {
            configuration: TEST_DASHBOARD_CONFIGURATION,
            authenticator,
            auditLog: audit,
            rooms: options.rooms,
            now: () => now,
            rateLimit: options.rateLimit,
        },
    });

    return {
        url,
        members,
        tags,
        audit,
        authenticator,
        setNow: (value: Date) => {
            now = value;
        },
    };
}

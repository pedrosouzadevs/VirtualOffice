/**
 * The dashboard's view of a member. Mirrors `AdminMemberView` on the server; the email is the identifier, and the
 * internal primary key is never sent (ADR-0002, decision #5).
 */
export interface Member {
    readonly email: string;
    readonly username: string | null;
    readonly tags: string[];
}

export interface GrantResult {
    readonly member: Member;
    /** True when the tag did not exist. A warning, not a success detail — see {@link grantTag}. */
    readonly createdTag: boolean;
}

export interface RevokeResult {
    readonly member: Member;
    readonly wasHeld: boolean;
}

/** An error the server described. `code` is the machine-readable one from its JSON body. */
export class ApiError extends Error {
    constructor(
        message: string,
        readonly code: string,
        readonly status: number,
    ) {
        super(message);
        this.name = "ApiError";
    }
}

const CSRF_COOKIE = "admin_csrf";
const CSRF_HEADER = "X-CSRF-Token";

/**
 * Reads the CSRF token the server put in a deliberately readable cookie.
 *
 * The value is not a secret on its own — it is worthless without the `HttpOnly` session cookie. What it buys is that
 * a cross-origin page cannot set a custom header, so it cannot replay a mutation with the browser's own credentials.
 */
function csrfToken(): string {
    const entry = document.cookie.split("; ").find((cookie) => cookie.startsWith(`${CSRF_COOKIE}=`));

    return entry?.slice(CSRF_COOKIE.length + 1) ?? "";
}

/** Sends the browser to the login, remembering where it was. */
function redirectToLogin(): never {
    const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/admin/login?returnTo=${returnTo}`;

    // `location.href` does not stop execution; throwing keeps callers from acting on a response that never came.
    throw new ApiError("Redirecting to the login.", "ADMIN_UNAUTHENTICATED", 401);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const mutating = init.method !== undefined && init.method !== "GET";

    const response = await fetch(`/admin/api${path}`, {
        ...init,
        headers: {
            ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
            ...(mutating ? { [CSRF_HEADER]: csrfToken() } : {}),
            ...init.headers,
        },
    });

    if (response.status === 401) {
        // The server answers `/admin/api/*` with JSON, never a redirect, precisely so this branch can exist: a
        // redirect would hand us an HTML login page under a 200 and we would try to parse it.
        redirectToLogin();
    }

    if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { details?: string; code?: string };

        throw new ApiError(
            body.details ?? `The request failed with status ${response.status}.`,
            body.code ?? "ADMIN_UNKNOWN_ERROR",
            response.status,
        );
    }

    return (await response.json()) as T;
}

/** Everyone, or those matching `search`. Both answers carry tags. */
export function listMembers(search: string): Promise<Member[]> {
    const query = search.trim() === "" ? "" : `?search=${encodeURIComponent(search.trim())}`;

    return request<Member[]>(`/members${query}`);
}

export function listTags(): Promise<string[]> {
    return request<string[]>("/tags");
}

/** A room, as `/admin/api/rooms` describes it. */
export interface Room {
    readonly path: string;
    readonly roomUrl: string;
    readonly wamUrl: string;
    readonly name: string;
    readonly description?: string;
    readonly thumbnail?: string;
}

/**
 * The world's rooms.
 *
 * Fails with `ADMIN_ROOMS_UNAVAILABLE` when `map-storage` is unreachable and `ADMIN_ROOMS_NOT_CONFIGURED` when this
 * deployment never said where it is. The screen tells those apart, because one is an outage and the other is a
 * setting nobody filled in.
 */
export function listRooms(): Promise<Room[]> {
    return request<Room[]>("/rooms");
}

/** A personal area's ownership, as `/admin/api/rooms/{path}/areas` describes it. */
export interface PersonalAreaDetails {
    /** The owner's email — what the map stores — or `null` when nobody has claimed the area. */
    readonly ownerId: string | null;
    readonly ownerName: string | null;
    /** True when the email has no member row: usually an area claimed before the Admin API was switched on. */
    readonly ownerUnknown: boolean;
    readonly allowedTags: string[];
    readonly accessClaimMode?: string;
}

/** An area drawn inside a map: a personal desk, a silent zone, a meeting spot. */
export interface Area {
    readonly id: string;
    readonly name: string;
    /** The raw property types the area carries, e.g. `silent`, `livekitRoomProperty`. */
    readonly kinds: string[];
    readonly personal?: PersonalAreaDetails;
}

/** The areas inside one map. `path` is the room's path, slashes and all. */
export function listAreas(path: string): Promise<Area[]> {
    // Each segment encoded separately: the slashes are part of the route, the rest of the path is data.
    const encoded = path.split("/").map(encodeURIComponent).join("/");

    return request<Area[]>(`/rooms/${encoded}/areas`);
}

/**
 * Grants a tag, creating the member and the tag if either is new.
 *
 * Callers must surface `createdTag`. Tags are free text and case-sensitive, so `Admin` is a brand new label that
 * grants nothing at all — the flag is how that mistake becomes visible at the click rather than at the next login.
 */
export function grantTag(email: string, tag: string): Promise<GrantResult> {
    return request<GrantResult>(`/members/${encodeURIComponent(email)}/tags`, {
        method: "POST",
        body: JSON.stringify({ tag }),
    });
}

export function revokeTag(email: string, tag: string): Promise<RevokeResult> {
    return request<RevokeResult>(`/members/${encodeURIComponent(email)}/tags/${encodeURIComponent(tag)}`, {
        method: "DELETE",
    });
}

export function setUsername(email: string, username: string | null): Promise<{ member: Member }> {
    return request<{ member: Member }>(`/members/${encodeURIComponent(email)}`, {
        method: "PATCH",
        body: JSON.stringify({ username }),
    });
}

/** The acting administrator. Served outside `/admin/api`, so it is fetched directly rather than through {@link request}. */
export async function fetchMe(): Promise<Member> {
    const response = await fetch("/admin/me");

    if (response.status === 401 || response.status === 302) {
        redirectToLogin();
    }

    if (!response.ok) {
        throw new ApiError("Could not identify the current administrator.", "ADMIN_ME_FAILED", response.status);
    }

    return (await response.json()) as Member;
}

export async function logout(): Promise<void> {
    // POST, never GET: logging out changes state (ADR-0004, mandatory test #9).
    await fetch("/admin/logout", { method: "POST", headers: { [CSRF_HEADER]: csrfToken() } });

    window.location.href = "/admin/login";
}

import type { AdminDashboardConfiguration } from "../../src/Application/AdminDashboardConfiguration";
import { issueSession, type AdminSession } from "../../src/Application/AdminSession";
import type { OidcAuthenticator, OidcIdentity, OidcTransaction } from "../../src/Application/Ports/OidcAuthenticator";
import { CSRF_HEADER, SESSION_COOKIE } from "../../src/api/AdminSessionCookies";

/** Long enough to clear `MINIMUM_SESSION_SECRET_LENGTH`; the value itself is never asserted on. */
export const TEST_SESSION_SECRET = "test-session-secret-that-is-long-enough";

export const TEST_DASHBOARD_CONFIGURATION: AdminDashboardConfiguration = {
    // http, so `secure` cookies stay off and the tests can read them back over plain HTTP.
    publicUrl: "http://admin-api.workadventure.localhost",
    sessionSecret: TEST_SESSION_SECRET,
    oidc: {
        issuer: "http://oidc.workadventure.localhost",
        clientId: "authorization-code-client-id",
        clientSecret: "authorization-code-client-secret",
        scope: "openid email profile",
        prompt: undefined,
    },
};

/**
 * An identity provider that answers instantly and can be told to fail.
 *
 * The barrier and the controller are what these tests are about; a real provider would only add a network round trip
 * and a reason for the suite to go red on someone else's downtime.
 */
export class StubOidcAuthenticator implements OidcAuthenticator {
    /** Set to make {@link completeAuthorization} throw, standing in for a denied or tampered callback. */
    public failure: Error | undefined;

    /** Recorded so a test can assert the transaction actually round-tripped through the cookie. */
    public lastTransaction: OidcTransaction | undefined;

    constructor(
        public email: string,
        public readonly authorizationUrl = "http://oidc.workadventure.localhost/connect/authorize?stub=1",
    ) {}

    createAuthorizationRequest(): Promise<{ authorizationUrl: string; transaction: OidcTransaction }> {
        return Promise.resolve({
            authorizationUrl: this.authorizationUrl,
            transaction: { state: "stub-state", codeVerifier: "stub-code-verifier" },
        });
    }

    completeAuthorization(input: { callbackUrl: string; transaction: OidcTransaction }): Promise<OidcIdentity> {
        this.lastTransaction = input.transaction;

        if (this.failure !== undefined) {
            return Promise.reject(this.failure);
        }

        return Promise.resolve({ email: this.email });
    }
}

/** A signed session plus the headers that make a request look like it came from that session's browser. */
export interface TestSession {
    readonly token: string;
    readonly session: AdminSession;
    /** `Cookie` and CSRF headers together — what an authenticated mutation has to send. */
    readonly headers: Record<string, string>;
    /** Cookie only, no CSRF token: the shape a cross-site forgery would manage. */
    readonly cookieOnlyHeaders: Record<string, string>;
}

/** Mints a session directly, so a test of the barrier does not have to walk the whole login flow to reach it. */
export async function signInAs(email: string, now: Date = new Date()): Promise<TestSession> {
    const { token, session } = await issueSession(email, TEST_SESSION_SECRET, now);

    return {
        token,
        session,
        headers: { Cookie: `${SESSION_COOKIE}=${token}`, [CSRF_HEADER]: session.csrfToken },
        cookieOnlyHeaders: { Cookie: `${SESSION_COOKIE}=${token}` },
    };
}

/**
 * Reads one cookie's value out of a response.
 *
 * `fetch` has no cookie jar, and the tests need to follow a session across requests — and to prove that logout and a
 * renewal really did rewrite the cookie.
 *
 * @returns the value, `""` when the cookie was cleared, or `undefined` when it was not set at all.
 */
export function readSetCookie(response: Response, name: string): string | undefined {
    const header = response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`));

    if (header === undefined) {
        return undefined;
    }

    return header.slice(name.length + 1).split(";")[0];
}

/** The attributes a `Set-Cookie` carries, lower-cased, so a test can assert on `httponly` without string matching. */
export function readCookieAttributes(response: Response, name: string): string[] {
    const header = response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`));

    if (header === undefined) {
        return [];
    }

    return header
        .split(";")
        .slice(1)
        .map((attribute) => attribute.trim().toLowerCase());
}

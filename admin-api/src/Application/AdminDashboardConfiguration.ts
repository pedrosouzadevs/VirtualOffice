/**
 * Everything `/admin/*` needs in order to exist.
 *
 * Gathered into one value so the rest of the code never asks "is the dashboard configured?" in pieces: either this
 * resolves and the routes are mounted, or it does not and they answer a single, uniform 503.
 */
export interface AdminDashboardConfiguration {
    /** Public origin a browser reaches us at. The OIDC redirect URI is derived from it. */
    readonly publicUrl: string;

    /** Signs the session cookie. Never the pusher's token (ADR-0004, decision #2). */
    readonly sessionSecret: string;

    readonly oidc: {
        readonly issuer: string;
        readonly clientId: string;
        readonly clientSecret: string | undefined;
        readonly scope: string;
        readonly prompt: string | undefined;
    };
}

export type AdminDashboardConfigurationResult =
    | { readonly enabled: true; readonly configuration: AdminDashboardConfiguration }
    | { readonly enabled: false; readonly missing: readonly string[] };

/**
 * Below this, an HMAC secret is guessable enough that a signed session stops being a security boundary.
 *
 * Checked here rather than in the environment schema because a short secret must disable the dashboard, never stop
 * the process: `/api/*` has to keep answering or the pusher's uncapped retry loop hangs `play` (ADR-0002, Trap #2).
 */
export const MINIMUM_SESSION_SECRET_LENGTH = 32;

/** Trailing slashes would produce `https://host//admin/callback`, which no provider will match against its allowlist. */
function stripTrailingSlashes(url: string): string {
    return url.replace(/\/+$/, "");
}

/**
 * Decides whether the dashboard can run, and says exactly what is missing when it cannot.
 *
 * A partially configured dashboard is treated as no dashboard on purpose. Booting one with, say, no session secret
 * would mean serving an unauthenticated permission editor, and that is strictly worse than serving nothing.
 */
export function resolveAdminDashboardConfiguration(input: {
    publicUrl: string | undefined;
    sessionSecret: string | undefined;
    issuer: string | undefined;
    clientId: string | undefined;
    clientSecret: string | undefined;
    scope: string;
    prompt: string | undefined;
}): AdminDashboardConfigurationResult {
    // Destructured so the single guard below narrows all four to `string` at once.
    const { publicUrl, sessionSecret, issuer, clientId, clientSecret, scope, prompt } = input;
    const missing: string[] = [];

    if (publicUrl === undefined) {
        missing.push("ADMIN_API_PUBLIC_URL");
    }

    if (sessionSecret === undefined || sessionSecret.length < MINIMUM_SESSION_SECRET_LENGTH) {
        missing.push(`ADMIN_API_SESSION_SECRET (at least ${MINIMUM_SESSION_SECRET_LENGTH} characters)`);
    }

    if (issuer === undefined) {
        missing.push("OPENID_CLIENT_ISSUER");
    }

    if (clientId === undefined) {
        missing.push("OPENID_CLIENT_ID");
    }

    // The dashboard reads the person's email out of the identity provider's answer, so a scope that cannot carry one
    // is a misconfiguration worth catching at boot rather than at the first login attempt.
    const scopes = scope.split(/\s+/).filter((entry) => entry !== "");
    for (const required of ["openid", "email"]) {
        if (!scopes.includes(required)) {
            missing.push(`OPENID_SCOPE (must include "${required}")`);
        }
    }

    if (
        missing.length > 0 ||
        publicUrl === undefined ||
        sessionSecret === undefined ||
        issuer === undefined ||
        clientId === undefined
    ) {
        return { enabled: false, missing };
    }

    return {
        enabled: true,
        configuration: {
            publicUrl: stripTrailingSlashes(publicUrl),
            sessionSecret,
            oidc: { issuer, clientId, clientSecret, scope, prompt },
        },
    };
}

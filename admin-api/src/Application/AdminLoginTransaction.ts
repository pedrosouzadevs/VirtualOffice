import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import type { OidcTransaction } from "./Ports/OidcAuthenticator";
import { toEpochSeconds } from "./AdminSession";

/**
 * How long someone has to finish logging in at the provider.
 *
 * Long enough for a password plus MFA, short enough that an abandoned login does not leave a usable transaction
 * cookie behind for the rest of the day.
 */
export const LOGIN_TRANSACTION_LIFETIME_SECONDS = 10 * 60;

const SIGNING_ALGORITHM = "HS256";

/** Where the browser is sent once the login succeeds. */
export const DEFAULT_RETURN_TO = "/admin/";

const TransactionClaims = z.object({
    state: z.string().min(1),
    verifier: z.string().min(1),
    returnTo: z.string().min(1),
});

export interface AdminLoginTransaction extends OidcTransaction {
    /** Always an in-app path; {@link sanitizeReturnTo} is what guarantees it. */
    readonly returnTo: string;
}

/**
 * Reduces a caller-supplied destination to something that cannot leave this application.
 *
 * `returnTo` is the classic open-redirect vector: it is attacker-controllable, it survives the trip to the identity
 * provider, and it is followed by a browser that has just been authenticated. Anything that is not plainly one of our
 * own `/admin` paths becomes the default.
 *
 * `//evil.example` and `/\evil.example` are rejected explicitly — both are protocol-relative URLs that browsers
 * happily treat as another origin despite looking like paths.
 */
export function sanitizeReturnTo(candidate: string | undefined): string {
    if (candidate === undefined || !candidate.startsWith("/admin/")) {
        return DEFAULT_RETURN_TO;
    }

    if (candidate.startsWith("//") || candidate.startsWith("/\\")) {
        return DEFAULT_RETURN_TO;
    }

    return candidate;
}

/**
 * Signs a pending login so the callback can trust what it reads back.
 *
 * Signed rather than encrypted: what has to hold is *integrity* — that `state` and `returnTo` are the ones we issued.
 * The PKCE verifier travels in the clear inside an `HttpOnly` cookie, which is the same exposure the session cookie
 * already carries, and reading it requires an attacker who has already defeated a stronger boundary.
 */
export function issueLoginTransaction(transaction: AdminLoginTransaction, secret: string, now: Date): Promise<string> {
    return new SignJWT({
        state: transaction.state,
        verifier: transaction.codeVerifier,
        returnTo: transaction.returnTo,
    })
        .setProtectedHeader({ alg: SIGNING_ALGORITHM })
        .setExpirationTime(toEpochSeconds(now) + LOGIN_TRANSACTION_LIFETIME_SECONDS)
        .sign(new TextEncoder().encode(secret));
}

/** @returns `undefined` for anything not a currently valid transaction, which the callback turns into a refusal. */
export async function verifyLoginTransaction(
    token: string,
    secret: string,
    now: Date,
): Promise<AdminLoginTransaction | undefined> {
    let claims: unknown;

    try {
        const verified = await jwtVerify(token, new TextEncoder().encode(secret), {
            algorithms: [SIGNING_ALGORITHM],
            currentDate: now,
        });
        claims = verified.payload;
    } catch {
        return undefined;
    }

    const parsed = TransactionClaims.safeParse(claims);

    if (!parsed.success) {
        return undefined;
    }

    return {
        state: parsed.data.state,
        codeVerifier: parsed.data.verifier,
        // Sanitised again on the way out. The signature proves we issued it, but a path that became unacceptable
        // between issuing and reading should still not be followed.
        returnTo: sanitizeReturnTo(parsed.data.returnTo),
    };
}

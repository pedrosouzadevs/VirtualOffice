import { randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";

/**
 * How long a session survives without activity. Renewed by use (ADR-0004, decision #6).
 *
 * Short on purpose: a signed session carries no server-side state, so it cannot be revoked before it expires. What
 * makes that acceptable is not the lifetime alone — it is that authorisation is re-read from the database on every
 * request, so the cookie only ever answers *who*, never *what they may do*.
 */
export const SESSION_LIFETIME_SECONDS = 60 * 60;

/**
 * The ceiling activity cannot push past.
 *
 * Without it, a stolen cookie kept warm by a script never expires and "one hour" describes nothing. With it, the
 * worst case is bounded: a stolen session dies within 12 hours however busy it is kept.
 */
export const SESSION_ABSOLUTE_LIFETIME_SECONDS = 12 * 60 * 60;

/** Only ever HS256. Stating it on both sides is what stops a token from choosing its own algorithm. */
const SIGNING_ALGORITHM = "HS256";

/**
 * The session, as the rest of the application sees it.
 *
 * Deliberately without tags: an administrator revoked mid-session must be refused on their next click, so the barrier
 * re-reads authorisation from the database rather than trusting a copy carried here (ADR-0004, decision #2).
 */
export interface AdminSession {
    /** The person's email — the key members are stored under. */
    readonly email: string;

    /** Random per-session value the CSRF defence compares the request header against. */
    readonly csrfToken: string;

    /** Sliding deadline, epoch seconds. Moves forward with activity. */
    readonly expiresAt: number;

    /** Absolute deadline, epoch seconds. Fixed at login and never extended. */
    readonly absoluteExpiresAt: number;
}

/**
 * Claims as they travel in the cookie.
 *
 * Parsed rather than cast: the signature proves *we* minted the token, not that its shape still matches this version
 * of the code. A token issued before a claim was renamed is a token we must reject, not misread.
 */
const SessionClaims = z.object({
    sub: z.string().min(1),
    csrf: z.string().min(1),
    /** The absolute deadline. Kept separate from `exp`, which slides. */
    abs: z.number().int().positive(),
    exp: z.number().int().positive(),
});

function encodeSecret(secret: string): Uint8Array {
    return new TextEncoder().encode(secret);
}

/** Epoch seconds, the unit every JWT claim here uses. */
export function toEpochSeconds(now: Date): number {
    return Math.floor(now.getTime() / 1000);
}

function signSession(session: AdminSession, secret: string): Promise<string> {
    return new SignJWT({ csrf: session.csrfToken, abs: session.absoluteExpiresAt })
        .setProtectedHeader({ alg: SIGNING_ALGORITHM })
        .setSubject(session.email)
        .setExpirationTime(session.expiresAt)
        .sign(encodeSecret(secret));
}

/**
 * Mints a session for someone who has just proven who they are.
 *
 * The sliding deadline is clamped to the absolute one from the very first token, so `exp` is never a promise the
 * absolute cap will refuse to keep.
 */
export async function issueSession(
    email: string,
    secret: string,
    now: Date,
): Promise<{ token: string; session: AdminSession }> {
    const issuedAt = toEpochSeconds(now);
    const absoluteExpiresAt = issuedAt + SESSION_ABSOLUTE_LIFETIME_SECONDS;

    const session: AdminSession = {
        email,
        csrfToken: randomBytes(32).toString("base64url"),
        expiresAt: Math.min(issuedAt + SESSION_LIFETIME_SECONDS, absoluteExpiresAt),
        absoluteExpiresAt,
    };

    return { token: await signSession(session, secret), session };
}

/**
 * Reads a session out of a cookie.
 *
 * @returns `undefined` for anything that is not a currently valid session — bad signature, wrong algorithm, expired,
 * past the absolute cap, or claims this version of the code no longer understands. One return value for every kind of
 * failure on purpose: the caller must treat them identically, and a caller that can tell them apart eventually starts
 * trusting one of them.
 */
export async function verifySession(token: string, secret: string, now: Date): Promise<AdminSession | undefined> {
    let claims: unknown;

    try {
        // `currentDate` makes expiry testable without waiting an hour, and keeps the sliding-window tests honest.
        const verified = await jwtVerify(token, encodeSecret(secret), {
            algorithms: [SIGNING_ALGORITHM],
            currentDate: now,
        });
        claims = verified.payload;
    } catch {
        return undefined;
    }

    const parsed = SessionClaims.safeParse(claims);

    if (!parsed.success) {
        return undefined;
    }

    // `exp` was already enforced by jose. The absolute cap is ours to check, and it is the whole reason a sliding
    // session is safe to offer at all.
    if (toEpochSeconds(now) >= parsed.data.abs) {
        return undefined;
    }

    return {
        email: parsed.data.sub,
        csrfToken: parsed.data.csrf,
        expiresAt: parsed.data.exp,
        absoluteExpiresAt: parsed.data.abs,
    };
}

/**
 * Whether the session is close enough to expiry to be worth re-issuing.
 *
 * Half the lifetime rather than every request: re-sending `Set-Cookie` on every call buys nothing and makes the
 * access log unreadable (ADR-0004, decision #6).
 */
export function isRenewalDue(session: AdminSession, now: Date): boolean {
    return session.expiresAt - toEpochSeconds(now) < SESSION_LIFETIME_SECONDS / 2;
}

/**
 * Extends a session that is being used, without ever moving its absolute deadline.
 *
 * @returns the new token and session, or `undefined` when renewal is not due — letting the caller skip the cookie.
 * A session already at its ceiling renews to the ceiling, which is a no-op rather than a special case.
 */
export async function renewSession(
    session: AdminSession,
    secret: string,
    now: Date,
): Promise<{ token: string; session: AdminSession } | undefined> {
    if (!isRenewalDue(session, now)) {
        return undefined;
    }

    const renewed: AdminSession = {
        ...session,
        expiresAt: Math.min(toEpochSeconds(now) + SESSION_LIFETIME_SECONDS, session.absoluteExpiresAt),
    };

    return { token: await signSession(renewed, secret), session: renewed };
}

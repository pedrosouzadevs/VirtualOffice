import { describe, expect, it } from "vitest";
import {
    SESSION_ABSOLUTE_LIFETIME_SECONDS,
    SESSION_LIFETIME_SECONDS,
    isRenewalDue,
    issueSession,
    renewSession,
    toEpochSeconds,
    verifySession,
} from "../src/Application/AdminSession";

const SECRET = "a-test-secret-long-enough-to-be-realistic";
const EMAIL = "john.doe@example.com";

/** Fixed so every assertion about a deadline is exact rather than "roughly now". */
const T0 = new Date("2026-07-31T09:00:00.000Z");

function minutesAfter(start: Date, minutes: number): Date {
    return new Date(start.getTime() + minutes * 60_000);
}

describe("issueSession", () => {
    it("sets the sliding deadline one lifetime out and the absolute one at the ceiling", async () => {
        const { session } = await issueSession(EMAIL, SECRET, T0);

        expect(session.email).toBe(EMAIL);
        expect(session.expiresAt).toBe(toEpochSeconds(T0) + SESSION_LIFETIME_SECONDS);
        expect(session.absoluteExpiresAt).toBe(toEpochSeconds(T0) + SESSION_ABSOLUTE_LIFETIME_SECONDS);
    });

    it("gives every session its own CSRF token", async () => {
        const first = await issueSession(EMAIL, SECRET, T0);
        const second = await issueSession(EMAIL, SECRET, T0);

        expect(first.session.csrfToken).not.toBe(second.session.csrfToken);
        expect(first.session.csrfToken.length).toBeGreaterThanOrEqual(32);
    });

    it("carries no tags", async () => {
        // Authorisation is re-read from the database on every request. A copy in the token would be a copy that goes
        // stale the moment an administrator is revoked (ADR-0004, decision #2).
        const { token } = await issueSession(EMAIL, SECRET, T0);
        const claims: unknown = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString());

        expect(claims).not.toHaveProperty("tags");
    });
});

describe("verifySession", () => {
    it("round-trips a freshly issued session", async () => {
        const { token, session } = await issueSession(EMAIL, SECRET, T0);

        await expect(verifySession(token, SECRET, T0)).resolves.toEqual(session);
    });

    it("refuses a token signed with another secret", async () => {
        const { token } = await issueSession(EMAIL, SECRET, T0);

        await expect(verifySession(token, "a-different-secret-of-adequate-length", T0)).resolves.toBeUndefined();
    });

    it("refuses a tampered payload", async () => {
        const { token } = await issueSession(EMAIL, SECRET, T0);
        const [header, payload, signature] = token.split(".");
        const claims: Record<string, unknown> = JSON.parse(
            Buffer.from(payload ?? "", "base64url").toString(),
        ) as Record<string, unknown>;

        claims.sub = "attacker@example.com";
        const forged = Buffer.from(JSON.stringify(claims)).toString("base64url");

        await expect(verifySession(`${header}.${forged}.${signature}`, SECRET, T0)).resolves.toBeUndefined();
    });

    it("refuses an unsigned token claiming alg:none", async () => {
        // The classic JWT forgery. Pinning the algorithm on verification is what makes it a non-event, and this test
        // is what stops someone from later "simplifying" that away.
        const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
        const payload = Buffer.from(
            JSON.stringify({
                sub: EMAIL,
                csrf: "forged",
                abs: toEpochSeconds(T0) + SESSION_ABSOLUTE_LIFETIME_SECONDS,
                exp: toEpochSeconds(T0) + SESSION_LIFETIME_SECONDS,
            }),
        ).toString("base64url");

        await expect(verifySession(`${header}.${payload}.`, SECRET, T0)).resolves.toBeUndefined();
    });

    it("refuses garbage rather than throwing", async () => {
        // The barrier turns `undefined` into "anonymous". A throw would surface as a 500 on a route whose whole job
        // is to answer politely to unauthenticated callers.
        await expect(verifySession("not-a-token", SECRET, T0)).resolves.toBeUndefined();
        await expect(verifySession("", SECRET, T0)).resolves.toBeUndefined();
    });

    it("refuses a session past its sliding deadline", async () => {
        const { token } = await issueSession(EMAIL, SECRET, T0);

        await expect(verifySession(token, SECRET, minutesAfter(T0, 59))).resolves.toBeDefined();
        await expect(verifySession(token, SECRET, minutesAfter(T0, 61))).resolves.toBeUndefined();
    });
});

describe("isRenewalDue", () => {
    it("waits until less than half the lifetime remains", async () => {
        const { session } = await issueSession(EMAIL, SECRET, T0);

        // Re-issuing Set-Cookie on every call buys nothing and only makes the access log harder to read
        // (ADR-0004, decision #6).
        expect(isRenewalDue(session, minutesAfter(T0, 29))).toBe(false);
        expect(isRenewalDue(session, minutesAfter(T0, 31))).toBe(true);
    });
});

describe("renewSession", () => {
    it("declines when renewal is not due", async () => {
        const { session } = await issueSession(EMAIL, SECRET, T0);

        await expect(renewSession(session, SECRET, minutesAfter(T0, 10))).resolves.toBeUndefined();
    });

    it("extends the sliding deadline while keeping the absolute one and the CSRF token", async () => {
        const { session } = await issueSession(EMAIL, SECRET, T0);
        const at = minutesAfter(T0, 45);

        const renewed = await renewSession(session, SECRET, at);

        expect(renewed?.session.expiresAt).toBe(toEpochSeconds(at) + SESSION_LIFETIME_SECONDS);
        expect(renewed?.session.absoluteExpiresAt).toBe(session.absoluteExpiresAt);
        // The CSRF token must survive renewal: rotating it would invalidate the copy the dashboard already holds and
        // make every in-flight mutation fail for no reason.
        expect(renewed?.session.csrfToken).toBe(session.csrfToken);
    });

    it("never lets the sliding deadline pass the absolute one", async () => {
        const { session } = await issueSession(EMAIL, SECRET, T0);
        const nearTheCeiling = minutesAfter(T0, 11 * 60 + 45);

        const renewed = await renewSession(session, SECRET, nearTheCeiling);

        expect(renewed?.session.expiresAt).toBe(session.absoluteExpiresAt);
    });

    it("dies at the absolute ceiling however continuously it is used (ADR-0004, mandatory test #8)", async () => {
        // Renew every 45 minutes — always due, always accepted — right up to the 12-hour mark, then once past it.
        let current = await issueSession(EMAIL, SECRET, T0);

        for (let elapsed = 45; elapsed < 12 * 60; elapsed += 45) {
            const at = minutesAfter(T0, elapsed);

            // Sequential on purpose: each renewal has to start from the token the previous one produced, which is
            // exactly the usage pattern the absolute cap has to survive.
            // eslint-disable-next-line no-await-in-loop
            const verified = await verifySession(current.token, SECRET, at);
            expect(verified, `the session should still be valid ${elapsed} minutes in`).toBeDefined();

            // eslint-disable-next-line no-await-in-loop
            const renewed = await renewSession(verified ?? current.session, SECRET, at);
            expect(renewed, `renewal should be due ${elapsed} minutes in`).toBeDefined();
            current = renewed ?? current;
        }

        // Constant activity bought eleven and a half hours of sliding, and not one second past the ceiling.
        await expect(verifySession(current.token, SECRET, minutesAfter(T0, 12 * 60 - 1))).resolves.toBeDefined();
        await expect(verifySession(current.token, SECRET, minutesAfter(T0, 12 * 60))).resolves.toBeUndefined();
        await expect(verifySession(current.token, SECRET, minutesAfter(T0, 12 * 60 + 1))).resolves.toBeUndefined();
    });
});

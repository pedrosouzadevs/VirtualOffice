import { describe, expect, it } from "vitest";
import {
    DEFAULT_RETURN_TO,
    LOGIN_TRANSACTION_LIFETIME_SECONDS,
    issueLoginTransaction,
    sanitizeReturnTo,
    verifyLoginTransaction,
} from "../src/Application/AdminLoginTransaction";

const SECRET = "a-test-secret-long-enough-to-be-realistic";
const T0 = new Date("2026-07-31T09:00:00.000Z");

describe("sanitizeReturnTo", () => {
    it("keeps an in-app path", () => {
        expect(sanitizeReturnTo("/admin/members")).toBe("/admin/members");
        expect(sanitizeReturnTo("/admin/members?search=ana")).toBe("/admin/members?search=ana");
    });

    it("falls back to the default when nothing was asked for", () => {
        expect(sanitizeReturnTo(undefined)).toBe(DEFAULT_RETURN_TO);
        expect(sanitizeReturnTo("")).toBe(DEFAULT_RETURN_TO);
    });

    it("refuses to leave the application", () => {
        // `returnTo` is attacker-controllable and is followed by a browser that has just authenticated, which is the
        // whole recipe for an open redirect.
        expect(sanitizeReturnTo("https://evil.example/steal")).toBe(DEFAULT_RETURN_TO);
        expect(sanitizeReturnTo("http://evil.example")).toBe(DEFAULT_RETURN_TO);
        expect(sanitizeReturnTo("/other/place")).toBe(DEFAULT_RETURN_TO);
    });

    it("refuses protocol-relative URLs that look like paths", () => {
        // Both are read by browsers as another origin despite the leading slash.
        expect(sanitizeReturnTo("//evil.example/steal")).toBe(DEFAULT_RETURN_TO);
        expect(sanitizeReturnTo("/\\evil.example/steal")).toBe(DEFAULT_RETURN_TO);
    });
});

describe("login transaction", () => {
    const transaction = { state: "the-state", codeVerifier: "the-verifier", returnTo: "/admin/members" };

    it("round-trips through the cookie", async () => {
        const token = await issueLoginTransaction(transaction, SECRET, T0);

        await expect(verifyLoginTransaction(token, SECRET, T0)).resolves.toEqual(transaction);
    });

    it("expires, so an abandoned login leaves nothing usable behind", async () => {
        const token = await issueLoginTransaction(transaction, SECRET, T0);
        const afterwards = new Date(T0.getTime() + (LOGIN_TRANSACTION_LIFETIME_SECONDS + 1) * 1000);

        await expect(verifyLoginTransaction(token, SECRET, afterwards)).resolves.toBeUndefined();
    });

    it("refuses a token signed with another secret", async () => {
        const token = await issueLoginTransaction(transaction, SECRET, T0);

        await expect(verifyLoginTransaction(token, "another-secret-entirely-and-long", T0)).resolves.toBeUndefined();
    });

    it("sanitises returnTo again on the way out", async () => {
        // Belt and braces: the signature proves we issued it, but a path that should never be followed should never
        // be followed, whoever wrote it.
        const token = await issueLoginTransaction({ ...transaction, returnTo: "//evil.example" }, SECRET, T0);

        const verified = await verifyLoginTransaction(token, SECRET, T0);

        expect(verified?.returnTo).toBe(DEFAULT_RETURN_TO);
    });
});

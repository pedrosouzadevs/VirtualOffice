import { describe, expect, it } from "vitest";
import {
    MINIMUM_SESSION_SECRET_LENGTH,
    resolveAdminDashboardConfiguration,
} from "../src/Application/AdminDashboardConfiguration";

const COMPLETE = {
    publicUrl: "https://admin.example.com",
    sessionSecret: "x".repeat(MINIMUM_SESSION_SECRET_LENGTH),
    issuer: "https://login.example.com",
    clientId: "client-id",
    clientSecret: "client-secret",
    scope: "openid email profile",
    prompt: undefined,
};

describe("resolveAdminDashboardConfiguration", () => {
    it("enables the dashboard when everything is present", () => {
        const result = resolveAdminDashboardConfiguration(COMPLETE);

        expect(result.enabled).toBe(true);
        expect(result.enabled && result.configuration.publicUrl).toBe("https://admin.example.com");
    });

    it("strips trailing slashes from the public URL", () => {
        // Otherwise the redirect URI becomes `https://host//admin/callback`, which no provider matches against its
        // registered allowlist — and the error surfaces at the provider, far from the typo.
        const result = resolveAdminDashboardConfiguration({ ...COMPLETE, publicUrl: "https://admin.example.com//" });

        expect(result.enabled && result.configuration.publicUrl).toBe("https://admin.example.com");
    });

    it("disables the dashboard and names everything missing at once", () => {
        const result = resolveAdminDashboardConfiguration({
            ...COMPLETE,
            publicUrl: undefined,
            issuer: undefined,
        });

        expect(result.enabled).toBe(false);
        expect(!result.enabled && result.missing).toEqual(["ADMIN_API_PUBLIC_URL", "OPENID_CLIENT_ISSUER"]);
    });

    it("treats a short session secret as no secret at all", () => {
        const result = resolveAdminDashboardConfiguration({ ...COMPLETE, sessionSecret: "too-short" });

        expect(result.enabled).toBe(false);
        expect(!result.enabled && result.missing.join(" ")).toContain("ADMIN_API_SESSION_SECRET");
    });

    it("rejects a scope that cannot carry an email", () => {
        // The email is the key members are stored under. Catching this at boot beats discovering it at the first
        // login, when the failure looks like a provider problem.
        const result = resolveAdminDashboardConfiguration({ ...COMPLETE, scope: "openid profile" });

        expect(result.enabled).toBe(false);
        expect(!result.enabled && result.missing.join(" ")).toContain("email");
    });

    it("accepts a public client with no secret", () => {
        // The development OIDC mock is configured with `RequireClientSecret: false`.
        const result = resolveAdminDashboardConfiguration({ ...COMPLETE, clientSecret: undefined });

        expect(result.enabled).toBe(true);
        expect(result.enabled && result.configuration.oidc.clientSecret).toBeUndefined();
    });
});

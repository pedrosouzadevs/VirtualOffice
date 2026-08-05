import { isCapabilities } from "@workadventure/messages";
import { afterEach, describe, expect, it } from "vitest";
import { SUPPORTED_CAPABILITIES } from "../src/Capabilities";
import { closeStartedServers, serveTestApp, TEST_ADMIN_API_TOKEN } from "./helpers/testApp";

afterEach(closeStartedServers);

describe("GET /api/capabilities", () => {
    it("validates against the very zod schema the pusher parses it with", async () => {
        const url = await serveTestApp();

        const response = await fetch(`${url}/api/capabilities`);

        expect(response.status).toBe(200);
        // isCapabilities is imported from @workadventure/messages: this asserts against the pusher's own contract,
        // so an upstream schema change breaks this test instead of production login.
        expect(isCapabilities.safeParse(await response.json())).toMatchObject({ success: true });
    });

    it("answers 200 with an empty body when no capability is implemented", async () => {
        // ADR-0002 mandatory test #4. This replaces the original "a 404 does not take play down": a 404 puts
        // AdminApi.initialise() into an uncapped retry loop and the pusher never opens its port.
        const url = await serveTestApp({ capabilities: {} });

        const response = await fetch(`${url}/api/capabilities`);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({});
    });

    it("answers without an Authorization header, because the pusher sends none", async () => {
        // Verified in AdminApi.fetchCapabilities: the call carries no request config at all, unlike every other
        // endpoint. Guarding this path would 403 the pusher into the same hang as a 404.
        const url = await serveTestApp();

        const response = await fetch(`${url}/api/capabilities`);

        expect(response.status).toBe(200);
    });

    it("still answers 200 when a valid token is sent anyway", async () => {
        const url = await serveTestApp();

        const response = await fetch(`${url}/api/capabilities`, {
            headers: { Authorization: TEST_ADMIN_API_TOKEN },
        });

        expect(response.status).toBe(200);
    });

    it("serves whatever the service declares it supports", async () => {
        const url = await serveTestApp({ capabilities: { "api/woka/list": "v1" } });

        const response = await fetch(`${url}/api/capabilities`);

        expect(await response.json()).toEqual({ "api/woka/list": "v1" });
    });

    it("only declares capabilities backed by an implemented endpoint", () => {
        // Guards against the reverse failure: declaring a capability routes real pusher traffic to an endpoint that
        // may not exist yet. Every key here must have a controller behind it.
        expect(SUPPORTED_CAPABILITIES).toEqual({ "api/woka/list": "v1", "api/companion/list": "v1" });
    });
});

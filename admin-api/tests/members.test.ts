import { MemberData } from "@workadventure/messages";
import { afterEach, describe, expect, it } from "vitest";
import { toMemberData } from "../src/Application/MemberDataMapper";
import {
    closeStartedServers,
    serveTestApp,
    StubMemberRepository,
    TEST_ADMIN_API_TOKEN,
    testMember,
} from "./helpers/testApp";

const auth = { headers: { Authorization: TEST_ADMIN_API_TOKEN } };

const withMembers = (...emails: [string, string?][]) =>
    new StubMemberRepository(emails.map(([email, username]) => testMember(email, [], username ?? null)));

afterEach(closeStartedServers);

describe("GET /api/members", () => {
    it("requires the admin token", async () => {
        const url = await serveTestApp();

        const response = await fetch(`${url}/api/members?searchText=a`);

        expect(response.status).toBe(403);
    });

    it("validates against the very zod schema the pusher parses it with", async () => {
        const url = await serveTestApp({ memberRepository: withMembers(["alice@example.com", "Alice"]) });

        const response = await fetch(`${url}/api/members?searchText=alice`, auth);

        expect(response.status).toBe(200);
        expect(MemberData.array().safeParse(await response.json())).toMatchObject({ success: true });
    });

    it("matches on email regardless of the casing typed into the picker", async () => {
        const url = await serveTestApp({ memberRepository: withMembers(["alice@example.com"]) });

        const response = await fetch(`${url}/api/members?searchText=ALICE`, auth);

        expect(((await response.json()) as MemberData[]).map((member) => member.email)).toEqual(["alice@example.com"]);
    });

    it("returns an empty list rather than everyone when the search box is cleared", async () => {
        // The picker queries on every keystroke, including the one that empties the field.
        const url = await serveTestApp({ memberRepository: withMembers(["alice@example.com"], ["bob@example.com"]) });

        const response = await fetch(`${url}/api/members?searchText=`, auth);

        expect(await response.json()).toEqual([]);
    });

    it("returns an empty list, not an error, when nothing matches", async () => {
        const url = await serveTestApp({ memberRepository: withMembers(["alice@example.com"]) });

        const response = await fetch(`${url}/api/members?searchText=nobody`, auth);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual([]);
    });
});

describe("GET /api/members/{id}", () => {
    it("requires the admin token", async () => {
        const url = await serveTestApp();

        const response = await fetch(`${url}/api/members/alice@example.com`);

        expect(response.status).toBe(403);
    });

    it("validates against the pusher's schema", async () => {
        const url = await serveTestApp({ memberRepository: withMembers(["alice@example.com", "Alice"]) });

        const response = await fetch(`${url}/api/members/alice@example.com`, auth);

        expect(response.status).toBe(200);
        expect(MemberData.safeParse(await response.json())).toMatchObject({ success: true });
    });

    it("resolves the id it is given back to the same member", async () => {
        // The front calls this with property.ownerId, which is whatever we returned as MemberData.id.
        const url = await serveTestApp({ memberRepository: withMembers(["alice@example.com"]) });

        const searched = (await (await fetch(`${url}/api/members?searchText=alice`, auth)).json()) as MemberData[];
        const fetched = (await (await fetch(`${url}/api/members/${searched[0]?.id ?? ""}`, auth)).json()) as MemberData;

        expect(fetched.email).toBe("alice@example.com");
    });

    it("answers a typed 404 for an unknown member, never HTML", async () => {
        // AdminApi.getMember does not validate what it receives, so an HTML body would surface as a confusing parse
        // error far from its cause.
        const url = await serveTestApp();

        const response = await fetch(`${url}/api/members/nobody@example.com`, auth);

        expect(response.status).toBe(404);
        expect(response.headers.get("content-type")).toContain("application/json");
        expect(await response.json()).toMatchObject({ status: "error", code: "MEMBER_NOT_FOUND" });
    });

    it("matches regardless of casing", async () => {
        const url = await serveTestApp({ memberRepository: withMembers(["alice@example.com"]) });

        const response = await fetch(`${url}/api/members/ALICE@EXAMPLE.COM`, auth);

        expect(response.status).toBe(200);
    });
});

describe("MemberData.id and userUuid must be the same identifier", () => {
    it("what the picker stores as owner is what the user is called at runtime", async () => {
        // ADR-0003 mandatory test #2, across the two endpoints that have to agree:
        //   /api/members        -> MemberData.id      -> personalAreaPropertyData.ownerId
        //   /api/room/access    -> userUuid           -> localUser.uuid
        // MapEditorModeManager compares those two. If they ever diverge, an owner assigned through the editor is a
        // person nobody can act as, and F4 breaks silently.
        const url = await serveTestApp({ memberRepository: withMembers(["alice@example.com", "Alice"]) });

        const searched = (await (await fetch(`${url}/api/members?searchText=alice`, auth)).json()) as MemberData[];
        const roomAccess = (await (
            await fetch(
                `${url}/api/room/access?userIdentifier=alice%40example.com&playUri=${encodeURIComponent(
                    "http://play.arqueum.localhost/~/maps/areas.wam",
                )}`,
                auth,
            )
        ).json()) as { userUuid: string };

        expect(searched[0]?.id).toBe(roomAccess.userUuid);
    });
});

describe("toMemberData", () => {
    it("uses the email as id, never the internal primary key", () => {
        // ADR-0003 mandatory test #2, and the regression guard for the trap it documents. MemberAutocomplete writes
        // this value into personalAreaPropertyData.ownerId, which MapEditorModeManager compares against the user's
        // local uuid — the email, because that is what /api/room/access returns as userUuid. Returning member.id
        // here would let an administrator assign an owner nobody can act as, breaking F4.
        const member = testMember("alice@example.com", [], "Alice");

        const data = toMemberData(member);

        expect(data.id).toBe("alice@example.com");
        expect(data.id).not.toBe(member.id);
    });

    it("carries the username as name, which is null until the dashboard fills it in", () => {
        expect(toMemberData(testMember("alice@example.com", [], "Alice")).name).toBe("Alice");
        expect(toMemberData(testMember("bob@example.com")).name).toBeNull();
    });

    it("returns a member with no tags rather than omitting them: MemberData carries none", () => {
        const data = toMemberData(testMember("alice@example.com"));

        expect(MemberData.safeParse(data)).toMatchObject({ success: true });
        expect(data).not.toHaveProperty("tags");
    });
});

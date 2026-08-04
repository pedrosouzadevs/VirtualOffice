import { jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import {
    buildKickMessages,
    groupRoomIdsByWorld,
    signAdminSocketJwt,
    toRoomIds,
} from "../src/Infrastructure/Play/AdminSocketWorldKicker";

const PLAY = "http://play.workadventure.localhost";

describe("toRoomIds", () => {
    it("builds the URL the pusher knows a room by: the public origin plus the in-world path", () => {
        expect(toRoomIds(["/~/maps/office.wam"], PLAY)).toEqual([`${PLAY}/~/maps/office.wam`]);
    });

    it("tolerates a trailing slash on the origin without doubling it", () => {
        expect(toRoomIds(["/~/maps/office.wam"], `${PLAY}/`)).toEqual([`${PLAY}/~/maps/office.wam`]);
    });
});

describe("groupRoomIdsByWorld", () => {
    it("groups by the sixth URL segment, exactly the expression the pusher filters with", () => {
        // IoSocketController: `roomId.split("/")[5] === message.world`. The pusher's contract, quirk included
        // (ADR-0006, decision #3). For a two-segment `/~/maps/x.wam` room that lands on the *file name*, so two
        // maps in the same folder are two different "worlds" to this filter — one message each.
        const groups = groupRoomIdsByWorld([
            `${PLAY}/~/maps/office.wam`,
            `${PLAY}/~/maps/library.wam`,
            `${PLAY}/~/maps/office.wam/annex`,
        ]);

        expect([...groups.keys()].sort()).toEqual(["library.wam", "office.wam"]);
        expect(groups.get("office.wam")).toEqual([`${PLAY}/~/maps/office.wam`, `${PLAY}/~/maps/office.wam/annex`]);
    });

    it("drops a URL too short to ever match the pusher's filter", () => {
        // `/~/lobby.wam` splits into five pieces; index 5 does not exist, so no world value can ever select it.
        // Sending it would be asking for a kick in no room at all.
        expect(groupRoomIdsByWorld([`${PLAY}/~/lobby.wam`]).size).toBe(0);
        expect(groupRoomIdsByWorld([`${PLAY}/~`]).size).toBe(0);
    });
});

describe("buildKickMessages", () => {
    it("sends one banned-type message per world, all signed with the shared token", async () => {
        const messages = await buildKickMessages(
            "shared-admin-sockets-token",
            [`${PLAY}/~/maps/office.wam`, `${PLAY}/~/maps/library.wam`],
            "troublemaker@example.com",
            "You have been banned by an admin",
        );

        expect(messages).toHaveLength(2);
        for (const message of messages) {
            expect(message).toMatchObject({
                event: "user-message",
                // "banned" is the branch that reaches emitBan; "ban" would merely send a warning text.
                message: { type: "banned", userUuid: "troublemaker@example.com" },
            });
        }
        expect(messages.map((message) => message.world).sort()).toEqual(["library.wam", "office.wam"]);
    });

    it("signs a JWT the pusher's verifyAdminSocketToken accepts: HS256 over the token, listing every room", async () => {
        const roomIds = [`${PLAY}/~/maps/office.wam`, `${PLAY}/~/maps/library.wam`];
        const [message] = await buildKickMessages("shared-admin-sockets-token", roomIds, "x@example.com", "Banned");

        // The same verification the pusher performs: jwtVerify with the shared secret.
        const { payload } = await jwtVerify(message?.jwt ?? "", new TextEncoder().encode("shared-admin-sockets-token"));

        expect(payload.authorizedRoomIds).toEqual(roomIds);
        expect(payload.exp).toBeDefined();
    });

    it("is refused by a verifier holding a different token", async () => {
        const jwt = await signAdminSocketJwt("the-right-token", [`${PLAY}/~/maps/a.wam`]);

        await expect(jwtVerify(jwt, new TextEncoder().encode("the-wrong-token"))).rejects.toThrow();
    });
});

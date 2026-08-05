import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { CompanionCatalogue } from "../../Application/CompanionCatalogue";
import type { BanRepository } from "../../Application/Ports/BanRepository";
import type { MemberRepository } from "../../Application/Ports/MemberRepository";
import {
    buildBannedRoomAccess,
    buildRoomAccess,
    type RoomAccessConfiguration,
} from "../../Application/RoomAccessService";
import type { WokaCatalogue } from "../../Application/WokaCatalogue";

/**
 * A repeated query parameter, which arrives as a string when there is one value and an array when there are several.
 */
const StringOrArray = z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
        if (value === undefined) return [];
        return Array.isArray(value) ? value : [value];
    });

const RoomAccessQuery = z
    .object({
        userIdentifier: z.string().min(1),
        playUri: z.string().min(1),
        ipAddress: z.string().optional(),
        characterTextureIds: StringOrArray,
        /**
         * The bracketed spelling axios produces for arrays. The `extended` query parser folds it into
         * `characterTextureIds`, so this is belt and braces — but the failure mode it guards against is silent
         * (empty textures reported as valid, avatars rendering blank), which is exactly when a second layer earns
         * its keep.
         */
        "characterTextureIds[]": StringOrArray,
        companionTextureId: z.string().optional(),
        accessToken: z.string().optional(),
        isLogged: z.string().optional(),
        chatID: z.string().optional(),
    })
    .transform(({ "characterTextureIds[]": bracketed, characterTextureIds, ...rest }) => ({
        ...rest,
        characterTextureIds: characterTextureIds.length > 0 ? characterTextureIds : bracketed,
    }));

/**
 * `GET /api/room/access` — decides who gets in, with which tags, and whether they may edit the map.
 *
 * This is where tag management becomes a practical effect: the pusher stops forwarding OIDC tags the moment
 * `ADMIN_API_URL` is set, so `tags` and `canEdit` come from our database and nowhere else.
 */
export class RoomAccessController {
    constructor(
        private readonly app: Express,
        private readonly members: MemberRepository,
        private readonly bans: BanRepository,
        private readonly wokaCatalogue: WokaCatalogue,
        private readonly companionCatalogue: CompanionCatalogue,
        private readonly configuration: RoomAccessConfiguration,
    ) {
        this.getRoomAccess();
    }

    private getRoomAccess(): void {
        this.app.get("/api/room/access", (req: Request, res: Response, next: NextFunction) => {
            (async () => {
                const query = RoomAccessQuery.safeParse(req.query);

                if (!query.success) {
                    res.status(400).json({
                        status: "error",
                        type: "error",
                        code: "INVALID_ROOM_ACCESS_QUERY",
                        title: "Invalid request",
                        subtitle: "",
                        details: "userIdentifier and playUri are required.",
                    });
                    return;
                }

                const { userIdentifier, playUri, characterTextureIds, companionTextureId, accessToken } = query.data;

                // The door (ADR-0006, decision #2). A separate, explicit branch so the rule below it stays whole:
                // banned is a fact we recorded about this identifier, unknown is the absence of one.
                const ban = await this.bans.findActive(userIdentifier);

                if (ban !== undefined) {
                    // 200 on purpose: the pusher's axios throws on non-2xx and would swallow this message.
                    res.status(200).json(buildBannedRoomAccess(ban));
                    return;
                }

                // An unknown visitor is not an error: they enter with no tags. Failing here would mean nobody new
                // could ever join the world.
                const known = await this.members.findByEmail(userIdentifier);

                // First arrival through the identity provider: record the person so an administrator can see them
                // and grant tags from the dashboard, instead of having to know and type an address that has never
                // appeared anywhere. The row carries no tags, so it grants exactly nothing on its own — invariant
                // #6 is untouched, and this runs once per person rather than once per connection.
                //
                // Only for somebody who actually authenticated. `accessToken` is present precisely when the pusher
                // completed an OIDC login; an anonymous visitor is identified by a uuid, and creating rows for
                // those would fill the member table with entries nobody can act on or recognise.
                const member =
                    known === undefined && accessToken !== undefined
                        ? await this.members.ensureMember(userIdentifier)
                        : known;

                const [characterTextures, companionTexture] = await Promise.all([
                    this.wokaCatalogue.resolveTextures(characterTextureIds),
                    companionTextureId === undefined
                        ? Promise.resolve(undefined)
                        : this.companionCatalogue.resolveTexture(companionTextureId),
                ]);

                res.status(200).json(
                    buildRoomAccess(
                        { userIdentifier, playUri, accessToken },
                        member,
                        {
                            characterTextures,
                            companionTextureRequested: companionTextureId !== undefined,
                            companionTexture,
                        },
                        this.configuration,
                    ),
                );
            })().catch((error: unknown) => {
                console.error(`[${new Date().toISOString()}] Failed to resolve room access`, error);
                next(error);
            });
        });
    }
}

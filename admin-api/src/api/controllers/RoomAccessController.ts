import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { CompanionCatalogue } from "../../Application/CompanionCatalogue";
import type { MemberRepository } from "../../Application/Ports/MemberRepository";
import { buildRoomAccess, type RoomAccessConfiguration } from "../../Application/RoomAccessService";
import type { WokaCatalogue } from "../../Application/WokaCatalogue";

/**
 * `characterTextureIds` arrives as a repeated query parameter, which Express parses as a string when there is one
 * value and an array when there are several. Both shapes have to be accepted.
 */
const StringOrArray = z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
        if (value === undefined) return [];
        return Array.isArray(value) ? value : [value];
    });

const RoomAccessQuery = z.object({
    userIdentifier: z.string().min(1),
    playUri: z.string().min(1),
    ipAddress: z.string().optional(),
    characterTextureIds: StringOrArray,
    companionTextureId: z.string().optional(),
    accessToken: z.string().optional(),
    isLogged: z.string().optional(),
    chatID: z.string().optional(),
});

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

                // An unknown visitor is not an error: they enter with no tags. Failing here would mean nobody new
                // could ever join the world.
                const member = await this.members.findByEmail(userIdentifier);

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

import { z } from "zod";
import { extendApi } from "@anatine/zod-openapi";
import { isApplicationDefinitionInterface } from "./ApplicationDefinitionInterface";
import { CompanionDetail } from "./CompanionTextures";
import { ErrorApiData } from "./ErrorApiData";
import { WokaDetail } from "./PlayerTextures";

/**
 * Response contract of the Admin API's `/api/room/access` endpoint.
 *
 * Moved here from `play/src/pusher/services/AdminApi.ts` so that both sides of the contract can import the same
 * schema instead of retyping it: the pusher validates incoming responses with it, and an Admin API implementation
 * asserts its own responses against it. `AdminApi.ts` re-exports everything below, so existing imports are unchanged.
 *
 * Its sibling `MapDetailsData` already lives in this folder, as do every type these definitions depend on.
 */
export const AdminLoginMessage = z.object({
  type: z.string(),
  message: z.string(),
});

export type AdminLoginMessage = z.infer<typeof AdminLoginMessage>;

export const isFetchMemberDataByUuidSuccessResponse = z.object({
  status: extendApi(z.literal("ok"), {
    description:
      "MUST be 'ok' if the system successfully authenticated the user.",
    example: "ok",
  }),
  email: extendApi(z.string().nullable(), {
    description:
      "The email of the fetched user, it can be an email, an uuid or null.",
    example: "example@workadventu.re",
  }),
  username: extendApi(z.string().nullable().optional(), {
    description: "The name of the fetched user.",
    example: "Greg",
  }),
  userUuid: extendApi(z.string(), {
    description: "The uuid of the fetched user, it can be an email, an uuid.",
    example: "998ce839-3dea-4698-8b41-ebbdf7688ad9",
  }),
  tags: extendApi(z.array(z.string()), {
    description: "List of tags related to the user fetched.",
    example: ["editor"],
  }),
  visitCardUrl: extendApi(z.string().nullable(), {
    description: "URL of the visitCard of the user fetched.",
    example: "https://mycompany.com/contact/me",
  }),
  isCharacterTexturesValid: extendApi(z.boolean(), {
    description:
      "True if the character textures are valid, false if we need to redirect the user to the Woka selection page.",
    example: true,
  }),
  characterTextures: extendApi(z.array(WokaDetail), {
    description:
      "This data represents the textures (WOKA) that will be available to users. If an empty array is returned, the user is redirected to the Woka selection page.",
  }),
  isCompanionTextureValid: extendApi(z.boolean(), {
    description:
      "True if the companion texture is valid, false if we need to redirect the user to the companion selection page.",
    example: true,
  }),
  companionTexture: extendApi(CompanionDetail.nullable().optional(), {
    description: "This data represents the companion texture that will be use.",
  }),
  messages: extendApi(z.array(AdminLoginMessage), {
    description:
      "Sets messages that will be displayed when the user logs in to the WA room. These messages are used for ban or ban warning.",
  }),
  userRoomToken: extendApi(z.optional(z.string()), {
    description: "",
    example: "",
  }),
  activatedInviteUser: extendApi(z.boolean().nullable().optional(), {
    description: "Button invite is activated in the action bar",
  }),
  applications: extendApi(
    z.array(isApplicationDefinitionInterface).nullable().optional(),
    {
      description: "The applications run into the customer's world",
    },
  ),
  canEdit: extendApi(z.boolean().nullable().optional(), {
    description: "True if the user can edit the map",
  }),
  world: extendApi(z.string(), {
    description: "name of the world",
  }),
  chatID: extendApi(z.string().optional(), {
    description: "ChatId of user",
  }),
  canRecord: extendApi(z.boolean().optional(), {
    description:
      "True if the user can record the room. In addition to this, the user still needs to have the correct tags as defined in the WAM settings.",
  }),
});

export type FetchMemberDataByUuidSuccessResponse = z.infer<
  typeof isFetchMemberDataByUuidSuccessResponse
>;

export const isFetchWorldChatMembers = z.object({
  total: z.number().positive(),
  members: z.array(isFetchMemberDataByUuidSuccessResponse),
});

export type FetchWorldChatMembers = z.infer<typeof isFetchWorldChatMembers>;

export const isFetchMemberDataByUuidResponse = z.union([
  isFetchMemberDataByUuidSuccessResponse,
  ErrorApiData,
]);

export type FetchMemberDataByUuidResponse = z.infer<
  typeof isFetchMemberDataByUuidResponse
>;

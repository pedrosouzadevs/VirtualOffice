import { z } from "zod";

/**
 * Response contract of the Admin API's `GET /api/ban` endpoint.
 *
 * Moved here from `libs/shared-utils/src/SharedAdminApi.ts` so that both sides of the contract can import the same
 * schema instead of retyping it: the pusher validates incoming responses with it, and an Admin API implementation
 * asserts its own responses against it. `SharedAdminApi.ts` re-exports it, so existing imports are unchanged.
 *
 * **`message` is required.** The pusher parses every answer with this schema, including the one for a user who is not
 * banned, so replying `{ is_banned: false }` alone fails on the path every user takes (ADR-0005, correction #6).
 */
export const AdminBannedData = z.object({
  is_banned: z.boolean(),
  message: z.string(),
});

export type AdminBannedData = z.infer<typeof AdminBannedData>;

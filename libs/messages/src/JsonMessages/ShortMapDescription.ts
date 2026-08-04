import { z } from "zod";
import { WAMMetadata } from "./WAMMetadata";

/**
 * Response contract of the Admin API's `GET /api/room/sameWorld` endpoint: one room of the world.
 *
 * Moved here from `play/src/pusher/services/ShortMapDescription.ts` so that both sides of the contract can import the
 * same schema instead of retyping it: the pusher validates incoming responses with it, and an Admin API
 * implementation asserts its own responses against it. That file re-exports everything below, so existing imports are
 * unchanged.
 *
 * **It merges {@link WAMMetadata}**, so a map's own `description`, `copyright`, `thumbnail` and search counts travel
 * at the top level of each entry rather than nested under a `metadata` key (ADR-0005, decision #5).
 */
const ShortMapDescription = z
  .object({
    name: z.string(),
    roomUrl: z.string(),
    wamUrl: z.string().optional(),
  })
  .merge(WAMMetadata);

export const ShortMapDescriptionList = z.array(ShortMapDescription);

export { ShortMapDescription };
export type ShortMapDescription = z.infer<typeof ShortMapDescription>;
export type ShortMapDescriptionList = z.infer<typeof ShortMapDescriptionList>;

import { z } from "zod";

/**
 * Metadata a map carries about itself: its name, description, copyright and thumbnail.
 *
 * Moved here from `libs/map-editor/src/types.ts` so that {@link ShortMapDescription} — the Admin API's
 * `/api/room/sameWorld` contract, which merges this — can live in this package too. `map-editor` already depends on
 * `@workadventure/messages`, so defining it the other way round would be a cycle; `types.ts` re-exports it, and every
 * existing import is unchanged.
 *
 * Every field is optional and nullable: a map is free to say nothing about itself.
 */
export const WAMMetadata = z.object({
  name: z.string().optional().nullable().describe("The name of the map."),
  description: z
    .string()
    .optional()
    .nullable()
    .describe(
      "A description of the map. Can be used in social networks when sharing a link to the map.",
    ),
  copyright: z
    .string()
    .optional()
    .nullable()
    .describe(
      "Copyright notice for this map. Can be a link to a license. Parts of this map like tilesets or images can have their own copyright.",
    ),
  thumbnail: z
    .string()
    .optional()
    .nullable()
    .describe(
      "URL to a thumbnail image. This image will be used in social networks when sharing a link to the map.",
    ),
  areasSearchable: z
    .number()
    .optional()
    .nullable()
    .describe(
      "Number of areas define as searchable by the map editor for the exploration mode.",
    ),
  entitiesSearchable: z
    .number()
    .optional()
    .nullable()
    .describe(
      "Number of entities define as searchable by the map editor for the exploration mode.",
    ),
});

export type WAMMetadata = z.infer<typeof WAMMetadata>;

/**
 * The `/api/room/sameWorld` contract now lives in @workadventure/messages, so that an Admin API implementation can
 * validate its own responses against the very schema the pusher parses them with, instead of retyping it.
 * Re-exported here to keep every existing import in this package working unchanged.
 */
export { ShortMapDescription, ShortMapDescriptionList } from "@workadventure/messages";

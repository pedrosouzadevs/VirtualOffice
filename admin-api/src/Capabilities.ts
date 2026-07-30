import type { Capabilities } from "@workadventure/messages";

/**
 * What this Admin API actually implements.
 *
 * The pusher uses this to decide, per feature, whether to call us or fall back to its own local implementation — see
 * `WokaService.get` and `CompanionService.get` in the pusher. Declaring a capability we have not built yet routes real
 * traffic to a missing endpoint, so this list only grows when the endpoint behind it exists.
 *
 * An empty object is a perfectly valid answer: it means "call none of the optional endpoints", which is exactly what
 * makes the phased delivery in ADR-0002 possible.
 */
export const SUPPORTED_CAPABILITIES: Capabilities = {
    // Backed by WokaListController. Declared so the pusher takes its catalogue from the same file we validate
    // character textures against on /api/room/access — see ADR-0002, Trap #3.
    "api/woka/list": "v1",
};

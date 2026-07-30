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
    // "api/woka/list": "v1"  <- added in P0/E3, together with the endpoint itself.
};

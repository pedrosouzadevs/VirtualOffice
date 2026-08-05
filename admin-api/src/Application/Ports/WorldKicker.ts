/**
 * Removes somebody from the running world (ADR-0006, decision #3).
 *
 * Declared here so the dependency points inward and so the ban endpoint's tests never need a live pusher. The one
 * implementation talks to the pusher's `/ws/admin/rooms` websocket.
 *
 * **Best-effort by contract.** A ban is the record plus the closed door (`/api/room/access`); the kick is the
 * courtesy of not waiting for the person's next reconnection. That is why this interface *answers* instead of
 * throwing: a pusher that is briefly down must never un-record a ban.
 */
export interface WorldKicker {
    /**
     * Asks the pusher to remove the identifier from every room of the world.
     *
     * @param identifier who to remove, as the pusher knows them — an email or an anonymous uuid.
     * @param message what the removed person is shown.
     * @returns `true` when the kick was delivered to the pusher; `false` when it could not be — unreachable,
     * misconfigured, or refused. Delivery is the honest claim: what each room did with it lands in the pusher's log.
     */
    kick(identifier: string, message: string): Promise<boolean>;
}

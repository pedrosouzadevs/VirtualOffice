/**
 * Something a person should find out about now, rather than by reading a table later.
 *
 * Deliberately a tiny closed set. An alerter that fires on everything is one nobody reads, and the whole reason
 * finding F1 asked for this is that the audit log already recorded the events and no one was looking.
 */
/**
 * What happened.
 *
 * - `admin.grant.refused` — somebody with a dashboard session or a shell tried to grant `admin`. Refused, and an
 *   attempt is worth knowing about on its own.
 * - `admin.revoked` — the set of administrators shrank. Legitimate most of the time, and never something anyone
 *   should discover by accident.
 */
export type AdminAlertKind = "admin.grant.refused" | "admin.revoked";

export interface AdminAlert {
    readonly kind: AdminAlertKind;

    /** Who acted: an administrator's email, or `cli`. */
    readonly actor: string;

    /** Who it was about. */
    readonly target: string;

    /** One sentence a human can act on without opening anything else. */
    readonly detail: string;
}

/**
 * Where alerts go.
 *
 * A port because "shout into the log" and "post to a webhook" are deployment choices, not application logic, and
 * because a test asserting that an alert was raised should not need either.
 *
 * Implementations must **never throw**: an alert that fails is not a reason to fail the request that triggered it.
 */
export interface AdminAlerter {
    raise(alert: AdminAlert): Promise<void>;
}

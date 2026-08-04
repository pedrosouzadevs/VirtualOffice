/**
 * Somebody one user complained about (ADR-0005, decision #4).
 *
 * Stored and readable, and in P3 it notifies nobody — deliberately. We do not yet know the volume, and a notification
 * channel nobody has agreed to watch is the failure mode the audit log already taught us.
 */
export interface ReportRecord {
    readonly id: string;

    /**
     * Who was reported, as the pusher named them. An **identifier**, not a member reference, for the same reasons the
     * ban table gives: a reporter and a reported person may both be anonymous visitors carrying a uuid, and a report
     * has to keep naming who they were after the account is gone.
     */
    readonly reportedIdentifier: string;

    /** Who complained, as the pusher named them. */
    readonly reporterIdentifier: string;

    /** What they wrote. The whole point of the record; kept verbatim, never summarised. */
    readonly comment: string;

    /** Where it happened — `reportWorldSlug` on the wire, which is the room URL despite the name. */
    readonly roomUrl: string;

    readonly createdAt: Date;
}

/** A report as it arrives, before storage gives it an id and a timestamp. */
export interface NewReport {
    readonly reportedIdentifier: string;
    readonly reporterIdentifier: string;
    readonly comment: string;
    readonly roomUrl: string;
}

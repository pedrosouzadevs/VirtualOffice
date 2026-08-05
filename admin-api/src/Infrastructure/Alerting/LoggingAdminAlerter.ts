import type { AdminAlert, AdminAlerter } from "../../Application/Ports/AdminAlerter";

/**
 * A stable, greppable marker.
 *
 * The point of a fixed prefix is that log-based alerting can match on it without understanding the message, so the
 * cheapest possible deployment — no webhook at all — still surfaces these.
 */
export const ALERT_MARKER = "[ADMIN-ALERT]";

/** A webhook that has not answered in this long is not going to. Alerting must not hold a request open. */
const WEBHOOK_TIMEOUT_MS = 3_000;

/**
 * Writes every alert to the log at `error` level, and optionally posts it to a webhook.
 *
 * Always logs, even when a webhook is configured: the log is the record that survives the webhook being
 * misconfigured, rate-limited or pointed at a channel nobody joined.
 *
 * Nothing here throws. An alert is a notification about something that already happened — failing the request that
 * triggered it would turn a monitoring problem into an outage.
 */
export class LoggingAdminAlerter implements AdminAlerter {
    constructor(
        /** Anything that accepts a JSON POST — Slack, Teams, a generic receiver. Absent means log only. */
        private readonly webhookUrl: string | undefined,
    ) {}

    public async raise(alert: AdminAlert): Promise<void> {
        const line = `${ALERT_MARKER} ${alert.kind} actor=${alert.actor} target=${alert.target} — ${alert.detail}`;

        // `error` rather than `warn`: these are the events an operator is meant to be paged about, and most log
        // pipelines route on level before they route on content.
        console.error(`[${new Date().toISOString()}] ${line}`);

        if (this.webhookUrl === undefined) {
            return;
        }

        try {
            await fetch(this.webhookUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                // `text` is what Slack and Teams both read; the structured fields are there for anything else.
                body: JSON.stringify({ text: line, ...alert }),
                signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
            });
        } catch (error: unknown) {
            console.error(`[${new Date().toISOString()}] Failed to deliver ${alert.kind} to the alert webhook`, error);
        }
    }
}

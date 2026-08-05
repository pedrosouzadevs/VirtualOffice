import type { AuditAction } from "../Domain/AuditEntry";
import type { AuditLogRepository } from "./Ports/AuditLogRepository";

/**
 * Who made a change.
 *
 * `{ kind: "cli" }` is deliberately anonymous: a command run inside the container has no logged-in identity, and
 * inventing one would put a name in the audit log that nobody can stand behind. An entry attributed to the CLI means
 * "somebody with shell access did this", which is the true and useful statement.
 */
export type Actor = { kind: "administrator"; email: string } | { kind: "cli" };

export const CLI_ACTOR: Actor = { kind: "cli" };

/** The value written to `actor_email`. Never a real address for the CLI, so the two can never be confused. */
export function actorLabel(actor: Actor): string {
    return actor.kind === "cli" ? "cli" : actor.email;
}

/**
 * Writes the audit entry for a change that has already happened (ADR-0004, decision #5).
 *
 * Lives in its own module rather than inside one service, because more than one service now writes to the log —
 * granting a tag, and banning somebody (ADR-0005). Two writers that could label the same actor differently would put
 * the same person in the log under two names, which is the one thing a log must never do.
 *
 * A failure does not fail the caller. The change did land, so reporting an error would misdescribe the world, and the
 * realistic cause — a database that is down or full — would have stopped the mutation first.
 */
export async function recordAudit(
    audit: AuditLogRepository,
    actor: Actor,
    action: AuditAction,
    targetEmail: string,
    details: Record<string, unknown>,
): Promise<void> {
    try {
        await audit.record({ actorEmail: actorLabel(actor), action, targetEmail, details });
    } catch (error: unknown) {
        console.error(
            `[${new Date().toISOString()}] Failed to record ${action} by ${actorLabel(actor)} on ${targetEmail}`,
            error,
        );
    }
}

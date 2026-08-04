import type { AdminBannedData } from "@workadventure/messages";
import type { BanRecord, NewBan } from "../Domain/Ban";
import { normalizeIdentifier } from "../Domain/Member";
import { recordAudit, type Actor } from "./AuditRecording";
import type { AuditLogRepository } from "./Ports/AuditLogRepository";
import type { BanRepository } from "./Ports/BanRepository";

/**
 * The stores banning needs.
 *
 * Bundled like {@link MemberAdministration}, and for the same reason: every surface that throws somebody out records
 * it the same way, and adding a store later is one signature change rather than one per call site.
 */
export interface BanAdministration {
    readonly bans: BanRepository;
    /** Banning is a mutation, so it is written to the log naming the actor, like every other one (ADR-0004, #5). */
    readonly audit: AuditLogRepository;
}

/**
 * Records a ban.
 *
 * The kick itself is the pusher's `emitBan`, which runs **after** this call returns and only if it does not throw —
 * that ordering is the whole reason P3 exists (ADR-0005): a 404 here left the administrator watching nothing happen
 * and the user still in the room.
 */
export async function banIdentifier(
    { bans, audit }: BanAdministration,
    actor: Actor,
    request: NewBan,
): Promise<BanRecord> {
    const recorded = await bans.record({
        ...request,
        identifier: normalizeIdentifier(request.identifier),
    });

    await recordAudit(audit, actor, "member.banned", recorded.identifier, {
        banId: recorded.id,
        roomUrl: recorded.roomUrl,
        message: recorded.message,
        displayName: recorded.displayName,
    });

    return recorded;
}

/**
 * Answers whether an identifier is banned, in the exact shape the pusher parses.
 *
 * **Both fields, always.** `AdminBannedData` requires `message` as well as `is_banned`, so an answer of
 * `{ is_banned: false }` alone fails the parse — on the path every single user takes (ADR-0005, correction #6).
 *
 * An identifier nobody ever banned is not an error, exactly as an unknown visitor is not an error to
 * `/api/room/access`: it is the answer for everyone, on every connection.
 */
export async function checkBan(bans: BanRepository, identifier: string): Promise<AdminBannedData> {
    const ban = await bans.findActive(normalizeIdentifier(identifier));

    return {
        is_banned: ban !== undefined,
        message: ban?.message ?? "",
    };
}

import { MAP_EDITOR_TAGS } from "../Domain/Member";
import type { MemberRepository } from "./Ports/MemberRepository";

export interface BootstrapResult {
    /** Tag names guaranteed to exist after the run. */
    ensuredTags: readonly string[];
    /** The bootstrapped administrator's email, or `undefined` when none was configured. */
    adminEmail: string | undefined;
}

/**
 * Brings the database to a usable state on every startup (ADR-0002, decision #6).
 *
 * Fully **idempotent**: every write is `ON CONFLICT DO NOTHING`, so running it on an already-configured database is a
 * no-op. That is what lets it run unconditionally at boot instead of being a one-shot script somebody has to
 * remember.
 *
 * The first administrator's email comes from an environment variable so it is neither hardcoded nor committed. With
 * no email configured the tags are still created and the service starts normally — a fresh environment simply has no
 * administrator until one is granted, which beats refusing to boot.
 */
export async function bootstrapAdmin(
    repository: MemberRepository,
    adminEmail: string | undefined,
): Promise<BootstrapResult> {
    const ensuredTags = await Promise.all(MAP_EDITOR_TAGS.map((tagName) => repository.ensureTag(tagName)));
    const tags = new Map(ensuredTags.map((ensured) => [ensured.name, ensured.id]));

    if (adminEmail === undefined || adminEmail.trim() === "") {
        console.info(
            "No ADMIN_API_BOOTSTRAP_ADMIN_EMAIL configured: tags are in place but no administrator was granted.",
        );
        return { ensuredTags: [...tags.keys()], adminEmail: undefined };
    }

    const admin = await repository.ensureMember(adminEmail);
    const adminTagId = tags.get("admin");

    if (adminTagId === undefined) {
        throw new Error('The "admin" tag was not created, so the bootstrap administrator cannot be granted it.');
    }

    await repository.grantTag(admin.id, adminTagId);
    console.info(`Bootstrap administrator ensured: ${admin.email}`);

    return { ensuredTags: [...tags.keys()], adminEmail: admin.email };
}

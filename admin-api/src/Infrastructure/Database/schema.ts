import { relations } from "drizzle-orm";
import { index, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * A person who can enter the world.
 *
 * Identity model from ADR-0002, decision #5: an **internal** primary key, with external identifiers as ordinary
 * columns. The pusher looks members up by email — `AuthenticateController` calls `createAuthToken(email, …)` and the
 * `sub` from OIDC is never forwarded — so `email` is the lookup key, but nothing else in the database may reference
 * it. Foreign keys point at `id`, which is what lets an email change without losing tags, areas or bans.
 */
export const member = pgTable("member", {
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * Stored lower-cased. Mail addresses are case-insensitive in practice while the identity provider is free to send
     * any casing, so normalising on the way in is what keeps "Dev@Example.com" and "dev@example.com" the same person.
     */
    email: text("email").notNull().unique(),

    /**
     * Filled on first login once an identity provider gives it to us. Staged for F2 (Azure Entra ID): storing the
     * `oid`/`sub` then means the lookup key can move off email later with no data migration.
     */
    oidcSub: text("oidc_sub").unique(),

    username: text("username"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * An authorisation label, e.g. `admin` or `editor`.
 *
 * Tags are per-member and world-agnostic in P0. When multiple worlds arrive this table gains a scope rather than
 * being rewritten (ADR-0002, decision #7).
 */
export const tag = pgTable("tag", {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Which tags a member holds. Cascades on both sides: a deleted member or tag must not leave dangling grants. */
export const memberTag = pgTable(
    "member_tag",
    {
        memberId: uuid("member_id")
            .notNull()
            .references(() => member.id, { onDelete: "cascade" }),
        tagId: uuid("tag_id")
            .notNull()
            .references(() => tag.id, { onDelete: "cascade" }),
        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [primaryKey({ columns: [table.memberId, table.tagId] })],
);

/**
 * Append-only record of every change the dashboard makes (ADR-0004, decision #5).
 *
 * **Deliberately without foreign keys**, which is the one place this schema breaks its own rule that references point
 * at `member.id`. That rule exists so an email change is a one-column update; an audit entry wants the opposite. It
 * has to answer "who did this, to whom, when" months later — after the actor has left, after the target's address
 * changed, after either row was deleted. A reference would either cascade the history away or quietly rewrite it, and
 * a log that changes with the world it describes is not a log.
 *
 * Nothing ever updates or deletes a row here. There is no code path that can.
 */
export const auditLog = pgTable(
    "audit_log",
    {
        id: uuid("id").primaryKey().defaultRandom(),

        /** The acting administrator's email, as it was at the time. A snapshot, not a reference. */
        actorEmail: text("actor_email").notNull(),

        /** What happened, from a closed set — see `Domain/AuditEntry.ts`. */
        action: text("action").notNull(),

        /** Who it happened to, again as a snapshot. */
        targetEmail: text("target_email").notNull(),

        /**
         * Whatever the action needs to be understandable on its own: the tag granted, the name set.
         *
         * `jsonb` so a new kind of action does not need a migration, and so the old rows stay readable when it does.
         */
        details: jsonb("details").notNull().default({}),

        createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
        // Newest first is how the log is always read, and the target index is what makes "everything that ever
        // happened to this person" cheap.
        index("audit_log_created_at_idx").on(table.createdAt),
        index("audit_log_target_email_idx").on(table.targetEmail),
    ],
);

export const memberRelations = relations(member, ({ many }) => ({
    memberTags: many(memberTag),
}));

export const tagRelations = relations(tag, ({ many }) => ({
    memberTags: many(memberTag),
}));

export const memberTagRelations = relations(memberTag, ({ one }) => ({
    member: one(member, { fields: [memberTag.memberId], references: [member.id] }),
    tag: one(tag, { fields: [memberTag.tagId], references: [tag.id] }),
}));

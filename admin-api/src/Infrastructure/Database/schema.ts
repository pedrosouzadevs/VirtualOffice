import { relations } from "drizzle-orm";
import { pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

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

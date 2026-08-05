# ADR-0003: Member and tag management (Admin API, P1)

- **Status:** Accepted
- **Date:** 2026-07-31
- **Deciders:** VirtualOffice team
- **Languages:** [0003-member-and-tag-management.pt-BR.md](0003-member-and-tag-management.pt-BR.md) (pt-BR) + this file (en-US), in lockstep.
- **Source:** [ADR-0002](0002-admin-api.md), phase P1. Spec [0001 — Feature Roadmap](../specs/0001-feature-roadmap.md), Feature 3.

## Context

P0 is delivered and running: `play` talks to `admin-api`, tags come from Postgres, and `canEdit` follows them. Two
gaps remain, and both are visible to whoever uses the product.

**Granting a permission means writing SQL by hand.** That is the original blocker of this roadmap in a new costume:
the tags are persisted now, but changing one is still not something a person can do through a screen.

**The personal-area "allowed user" field is dead.** [`MemberAutocomplete.svelte`](../../play/src/front/Components/Input/MemberAutocomplete.svelte)
feeds `PersonalAreaPropertyEditor`, and it calls `searchMembers`, which we do not implement. This is pending item #4
of Spec 0001, and it is the field that would let **F4's** area ownership be *assigned* by an administrator rather
than only *claimed* by whoever walks in first.

P1 closes both. The dashboard itself is P2 and is explicitly **not** in scope here.

## Verified contract

Four endpoints, read from [`AdminApi.ts`](../../play/src/pusher/services/AdminApi.ts) rather than from the docs — the
practice ADR-0002 adopted after five documented behaviours turned out not to exist.

| Endpoint | Query | Answer | Pusher validates? |
|---|---|---|---|
| `/api/members` | `playUri`, `searchText` | `MemberData[]` | ✅ `MemberData.array().parse` |
| `/api/members/{uuid}` | — | `MemberData` | ❌ **no** |
| `/api/world/tags` | `playUri`, `searchText` | `string[]` | ❌ **no** |
| `/api/room/tags` | `roomUrl` | `string[]` | ✅ `z.string().array().parse` |

`MemberData` is `{ id, name (nullable), email (nullable), visitCardUrl?, chatID? }`.

### The trap: `MemberData.id` must be the email

Returning our internal primary key here would look tidy and would break **F4**, which is already shipped. The chain:

```
MemberAutocomplete            → value: member.id
  → setOwnerId()              → property.ownerId = selectedOwner.value
    → MapEditorModeManager:523  compares ownerId !== userUUID
      → userUUID = localUser.uuid = userUuid from /api/room/access = the email
```

An owner assigned through the picker would be written with an identifier that never matches the person at runtime:
the area would have a phantom owner nobody can act as. The same applies in reverse — `/api/members/{uuid}` receives
`property.ownerId`, so that path segment is an **email**, whatever its name suggests.

This is ADR-0002 decision #5 for the third time: **the internal primary key never leaves the database.** It has
already been nearly leaked through `userUuid` (P0/E5) and now through `MemberData.id`. It deserves an explicit test
rather than a comment.

### Two endpoints the pusher does not validate

`getMember` and `searchTags` return `response.data` straight from axios with no `zod` parse. A malformed answer from
us therefore fails somewhere downstream instead of at the boundary, with a far worse error message. **We validate our
own output for those two**, so the failure lands on our side of the line where it can be diagnosed.

### Names never reach us

`/api/room/access` receives no name — only `userIdentifier`, `playUri`, `ipAddress`, textures and the token. Our
`member.username` column is therefore never populated by the normal flow, and `MemberData.name` is `null`. See
decision #2 for why we are keeping it that way, and what that costs.

## Decisions

### 1. `MemberData.id` is the member's email

Same identifier as `userUuid` on `/api/room/access`, for the reason above. Our `member.id` (uuid) stays internal.

The cost is that our public identifier changes if someone's email changes — but that is already true of `userUuid`,
and personal areas already store the email. Nothing gets worse; the internal key remains the stable anchor for tags,
grants and future ownership records.

### 2. Do **not** declare the `api/save-name` capability

Declaring it would populate `member.username` from the name the user types, which would be convenient. It also makes
the front **bypass the woka-name policy entirely** — [`ConnectionManager.ts:636`](../../play/src/front/Connection/ConnectionManager.ts):

```ts
if (hasCapability("api/save-name")) {
    gameManager.setPlayerName(username);   // opidWokaNamePolicy never consulted
} else {
    // only here are force_opid / allow_override_opid honoured
}
```

We want `allow_override_opid` — the identity provider supplies a default name, the person may change it. That is
precisely what the capability would switch off, so we leave it undeclared and `opidWokaNamePolicy` remains the
mechanism. We already serve that field from `/api/map` (P0/E3).

There is also an unresolved risk in the other direction: the `username` the front applies comes from the **OIDC
token** (`AuthenticateController.ts:318` → `MeResponse`), not from our database. With the capability declared, a name
the user edited could plausibly be overwritten by the provider's value on the next login. We did not chase that to
the end, because the decision above makes it moot.

> **Cost, stated plainly:** `MemberData.name` stays `null`, so the member autocomplete shows email addresses only.
> Mitigated by a `member:set-name` command in the CLI below, which is enough for the handful of people who appear in
> those pickers. A real fix arrives with the dashboard in P2.

### 3. Manage members and tags through a CLI, not an HTTP API

P1 needs a way to grant a tag without SQL. It does **not** need an HTTP management API — the only consumer of one
would be the dashboard, which is P2.

Shipping that API now would mean protecting it with the token `admin-api` already shares with the pusher, and that
token would then also confer the power to grant anyone any permission. Widening a machine-to-machine secret into a
privilege-granting one, months before anything consumes it, buys nothing.

The CLI runs inside the container with the service's own database credentials, adds no network surface, and is
scriptable for bulk work. The HTTP surface arrives in P2 authenticated with OIDC, gated on the `admin` tag — the
circularity that ADR-0002's decision #6 (bootstrap) exists to break.

### 4. `OPID_WOKA_NAME_POLICY=allow_override_opid`

Set in `.env.template` so the intent is recorded rather than implied. It has no effect until an identity provider
actually emits a username claim — the development OIDC mock issues `name`, while `OPENID_USERNAME_CLAIM` defaults to
`username` — so this is preparation for **F2 (Azure Entra ID)**, where the claim will be pointed at `name` or
`preferred_username`.

## Alternatives considered

### A. Declare `api/save-name` to populate `username`
- **Pros:** names appear in the autocomplete with no extra work; the name follows the person across devices.
- **Cons:** disables `opidWokaNamePolicy`, which is the mechanism for the chosen `allow_override_opid` behaviour;
  plausible overwrite of the user's edit on each login.
- **Rejected** — it trades a UI nicety for the control the team explicitly asked for.

### B. HTTP management API in P1, with its own token
- **Pros:** advances P2; scriptable over the network.
- **Cons:** a privilege-granting endpoint protected by a shared secret, with no consumer for months.
- **Rejected** for P1; this is what P2 builds, with real authentication.

### C. Keep managing tags in SQL
- **Pros:** zero work.
- **Cons:** leaves the original blocker of the roadmap half-solved.
- **Rejected.**

## Consequences

### Positive
- The personal-area owner picker starts working, which makes **F4**'s ownership assignable instead of only claimable.
- Tag management stops requiring SQL.
- No new authentication surface, and no change to the name-handling behaviour.

### Negative
- `MemberData.name` is `null` until P2, so pickers show emails.
- The CLI is reachable only by whoever can exec into the container — deliberate, but it means no remote management
  until P2.

### Neutral
- `api/save-name` and `api/save-textures` stay undeclared. The latter was never in scope: it would persist outfits
  server-side and touches the texture resolution repaired in P0.

## Implementation plan

| Slice | Scope |
|---|---|
| **F0** | `/api/members` and `/api/members/{id}`, `id` = email. Regression test that it matches `userUuid`. Unblocks the owner picker. |
| **F1** | `/api/world/tags` and `/api/room/tags`, read from the `tag` table. |
| **F2** | CLI: `member:list`, `member:grant`, `member:revoke`, `member:set-name`, `tag:list`. |
| **F3** | `OPID_WOKA_NAME_POLICY` in `.env.template`, bilingual docs, e2e of the owner picker. |

## Mandatory tests

1. **Contract test** per endpoint against `MemberData` imported from `@workadventure/messages` — never retyped.
2. **`MemberData.id` equals the `userUuid` returned by `/api/room/access` for the same person.** This is the
   regression test for the trap above; a comment is not enough, it has already nearly happened twice.
3. A member with no tags is returned, not omitted: absence of tags is not absence of the member.
4. Search matches on email regardless of casing, consistent with the lower-cased storage from P0/E4.
5. Unknown member on `/api/members/{id}` → `404` with a typed error body, never HTML.
6. Every CLI command is idempotent: granting twice, revoking twice, neither is an error.
7. Wrong token → 403, on the new endpoints as on the existing ones.

## References

- [ADR-0002 — Our own Admin API](0002-admin-api.md) — the contract, its traps, and P0
- [`play/src/pusher/services/AdminApi.ts`](../../play/src/pusher/services/AdminApi.ts) — source of truth for all four endpoints
- [`play/src/front/Components/Input/MemberAutocomplete.svelte`](../../play/src/front/Components/Input/MemberAutocomplete.svelte) — the consumer that makes `MemberData.id` load-bearing
- [`play/src/front/Connection/ConnectionManager.ts`](../../play/src/front/Connection/ConnectionManager.ts) — where `api/save-name` overrides the name policy
- [Setup — `admin-api`](../SETUP-ADMIN-API.md)

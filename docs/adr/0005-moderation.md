# ADR-0005: Moderation (Admin API, P3)

- **Status:** Accepted
- **Date:** 2026-08-04
- **Deciders:** ArqueumSpace team
- **Languages:** this file (en-US) + [0005-moderation.pt-BR.md](0005-moderation.pt-BR.md), in lockstep
- **Origin:** [ADR-0002](0002-admin-api.md), phase P3. Last phase of F3 before F2.

## Context

P0 through P2 are delivered. The phase table in ADR-0002 describes what is left in one line: *"P3 — Moderation:
`/api/ban`, `/api/report`, worlds, `/api/room/same`."*

Reading the pusher rather than that line changes the phase substantially. **This is not new functionality — it is
repair.**

### These endpoints are not capability-gated

[`CapabilitiesData.ts`](../../libs/messages/src/JsonMessages/CapabilitiesData.ts) declares eight capabilities. None
of them covers ban, report or `sameWorld`. The pusher therefore calls those endpoints **unconditionally** whenever
`ADMIN_API_URL` is set — there is no negotiation and no way to opt out, unlike the woka and companion catalogues.

`ADMIN_API_URL` has been set since P0/E6.

### So two features are broken right now

```ts
// SocketManager.handleBanPlayerMessage
await adminService.banUserByUuid(...);   // 404 from us → axios throws
await this.emitBan(...);                 // never runs
```

Banning today: an administrator clicks ban, we answer 404, the `await` throws, and `emitBan` — the part that actually
kicks the person — is never reached. The failure is swallowed by a `try/catch` that logs to Sentry. **The
administrator sees nothing happen, and the user is not even kicked.**

Reporting is the same shape, minus the second effect: `handleReportMessage` catches, logs, and the report is lost.

Turning `ADMIN_API_URL` on did this. It is the fourth item on ADR-0002's "important side effects" list that nobody
wrote down, and it is the reason P3 should not wait for F2.

## What the code actually says

Eight corrections to the phase description and to the pusher's own OpenAPI comments. Each one is a defect an
implementer would otherwise ship.

| # | The documentation says | The code does |
|---|---|---|
| 1 | `/api/ban` is an endpoint | **Two endpoints on one path.** `GET` checks, `POST` issues. Different shapes entirely. |
| 2 | `GET /api/ban` takes "the uuid of the user" | The parameter is named **`token`**, not `userUuid`. |
| 3 | `/api/report` parameters are `in: "query"` | They are a **JSON body**, and `roomUrl` is renamed **`reportWorldSlug`**. |
| 4 | The route is `/api/room/same` | It is **`/api/room/sameWorld`**. |
| 5 | — | `tags` is a **comma-joined string**, not repeated parameters — the opposite of `characterTextureIds`. |
| 6 | `AdminBannedData` requires `is_banned` | It requires **`is_banned` *and* `message`**. Answering `{is_banned:false}` alone fails the parse — on the common path. |
| 7 | — | **Nothing calls `verifyBanUser`.** It exists in the interface and both implementations, and has no caller anywhere in the repository. |
| 8 | — | **No capability gates any of this**, so all of it is called the moment `ADMIN_API_URL` is set. |

Corrections 1, 2, 3 and 6 each produce a silent failure. Correction 6 is the worst: it breaks the *non-banned* path,
which is every user.

## Decision 1 — A ban is global to the member, and records where it was issued

The contract sends `playUri`. What we do with it is ours to choose.

One world exists (ADR-0002, decision #7), so a per-room ban would be a distinction with no consequence and no screen
to express it. A ban is stored against the member, with the room URL kept as **evidence rather than as scope** — the
same shape the audit log uses, and the same upgrade path tags have when worlds arrive.

**Against the member, not against `member.id`.** Implementing this made the difference concrete: the pusher names the
banned person with whatever it holds in `socketData.userUuid`, which is an email for anyone who logged in and an
anonymous uuid for a visitor who did not. A foreign key would force an anonymous visitor to become an account nobody
can ever log into, and `on delete cascade` would mean deleting a member lifts their ban — exactly backwards. So the
ban table stores an identifier snapshot and carries no foreign keys, which is the audit log's rule rather than an
exception to it. The same applies to `report`.

## Decision 2 — A ban still will not survive reconnection, and P3 does not change that

This is the uncomfortable one, and it needs saying plainly.

Correction #7 means nothing reads the ban. Implementing `GET /api/ban` perfectly changes nothing on its own: the
pusher never asks. A ban therefore does what it does today — it kicks the person from the running session — and they
may reconnect immediately.

Making a ban stick requires the pusher to call `verifyBanUser` on connection. That is a change in `play`, not in
`admin-api`, and it is **out of scope for F3**, which ADR-0002 scoped as "our own Admin API".

**What P3 delivers is therefore honest and limited:** the ban is *recorded*, the kick *works again*, and the check is
*answerable*. Enforcement on reconnect becomes a separate, small piece of work against `play` — worth its own entry
on the roadmap, and worth not pretending is included here.

We implement `GET /api/ban` anyway, for two reasons: it is a lookup on a table P3 builds regardless, and a 404 on a
path the pusher's own interface declares is a trap for whoever wires that caller up later.

> **Revised 2026-08-04 by [ADR-0006](0006-dashboard-issued-bans.md).** A ban now *does* survive reconnection — not
> by the pusher calling `verifyBanUser`, but by our own `/api/room/access` answering `ErrorApiData` for a banned
> identifier, which the pusher already turns into a refused connection. No `play` change was needed after all, and
> the IP decision (#3) was not reopened. What this section says remained true for the whole of P3.

## Decision 3 — IP addresses are accepted and not stored

`GET /api/ban` receives `ipAddress`. Storing it would let bans follow a device rather than an account.

We do not. An IP address is personal data under the LGPD, it identifies a household rather than a person, and it is
the one field here with a retention obligation attached. The parameter is accepted, used for nothing, and dropped.

If IP-based banning is ever wanted it is a deliberate feature with its own retention policy — not a column that
appeared because a query string offered it.

## Decision 4 — Reports are stored, and notify nobody in P3

A report goes into an append-only table, readable from the dashboard and the CLI, like the audit log.

Deliberately no email, no webhook, no queue. We do not yet know the volume, and a notification channel nobody has
agreed to watch is the failure mode the audit log already taught us — the alerting from the threat model's F1 exists
precisely because writing a row is not the same as telling someone.

When someone owns triage, `AdminAlerter` is already the seam.

## Decision 5 — `/api/room/sameWorld` reuses the room catalogue G3 built

G3 already reads `/maps` from `map-storage` behind `RoomCatalogue`, and `LocalAdmin.getUrlRoomsFromSameWorld` is the
executable specification for the shape. This is a mapping over what exists, not a new integration.

Two contract details it must honour: `ShortMapDescription` merges `WAMMetadata`, so the metadata fields travel with
each entry; and `tags` arrives comma-joined, with `bypassTagFilter` as the string `"true"`/`"false"`.

**Tag filtering is where a decision hides.** The parameter exists so a world can hide rooms from users who lack a
tag. Nothing in our data model expresses "this room requires that tag" — that lives in the map. P3 therefore
**ignores `tags` and returns every room**, which is what `LocalAdmin` does today, and records the gap here rather
than inventing a rule the map editor cannot express.

## Decision 6 — No new capabilities are declared

There is nothing to declare: correction #8 shows the capability list has no key for any of these. Declaring the
unrelated ones we already skip stays out of scope — `api/save-name` in particular remains undeclared for the reason
ADR-0003 decision #2 gives.

## Alternatives considered

### A. Wait for F2 and do moderation afterwards
- **Pros:** F2 unblocks retiring the mock, which the roadmap wants sooner.
- **Cons:** leaves banning and reporting broken in the meantime, and they are broken *because of our own change*.
- **Rejected.** Repairing something we broke outranks the next feature.

### B. Implement only `POST /api/ban` and `/api/report`, skip the rest
- **Pros:** smallest slice that fixes the two broken features.
- **Cons:** leaves `/api/room/sameWorld` returning 404 on a path the pusher calls unconditionally, which is the same
  class of silent breakage this ADR exists to fix.
- **Rejected**, though it is a reasonable first slice — see the plan.

### C. Also patch `play` to enforce bans on reconnect
- **Pros:** makes a ban mean what everyone assumes it means.
- **Cons:** changes a second service, and F3 is scoped to `admin-api`. It also needs the IP decision reopened.
- **Deferred**, deliberately and visibly, rather than silently.

## Consequences

### Positive
- Two features the P0 rollout silently broke start working again.
- Bans and reports become evidence rather than events that vanish.
- The last phase of F3 closes, and F2 starts from a complete foundation.

### Negative
- A ban still does not survive reconnection. P3 makes that fact explicit instead of implied.
- Two more tables, and the retention question they bring with them.

### Neutral
- `GET /api/ban` ships unexercised by any caller, so it carries its own tests and no e2e.

## Implementation plan

| Slice | Scope |
|---|---|
| **H0** | The `ban` table, `POST /api/ban`, `GET /api/ban` answering both required fields. Fixes the kick. |
| **H1** | The `report` table and `POST /api/report`. Fixes the lost report. |
| **H2** | `GET /api/room/sameWorld` over the existing `RoomCatalogue`. |
| **H3** | Dashboard: bans and reports as read-only screens; CLI `ban:list` and `report:list`; bilingual docs. *Revised: [ADR-0006](0006-dashboard-issued-bans.md) later made the dashboard issue bans too; reports stay read-only.* |

H0 first because it is the one with a user-visible failure attached today.

## Mandatory tests

1. `GET /api/ban` answers **both** `is_banned` and `message`, and validates against the very `AdminBannedData` schema
   the pusher parses it with — for a banned user and, especially, for one who is not.
2. `GET /api/ban` reads the user from the **`token`** parameter.
3. `POST /api/ban` accepts the body the pusher sends, field for field, and records who issued it.
4. Issuing a ban writes an audit entry naming the actor, like every other mutation.
5. `POST /api/report` accepts a **JSON body** carrying `reportWorldSlug`, not a query string.
6. `GET /api/room/sameWorld` validates against `ShortMapDescriptionList`, metadata fields included.
7. `sameWorld` tolerates `tags` as a comma-joined string and `bypassTagFilter` as a string, and returns every room.
8. An IP address supplied to `GET /api/ban` is not written anywhere.
9. A ban on an unknown member answers `is_banned: false` rather than an error — the same rule `/api/room/access`
   follows for unknown visitors.
10. End to end: an administrator bans someone in `play` and the person is actually kicked, which is what is broken
    today.

## References

- [ADR-0002 — the Admin API](0002-admin-api.md) — the contract, its traps, and the phase table this closes
- [ADR-0004 — the dashboard](0004-admin-dashboard.md) — the audit log and alerting this reuses
- [Threat model](../security/threat-model.md) — F1's alerting seam, and the PII rule behind decision #3
- [`play/src/pusher/services/SocketManager.ts`](../../play/src/pusher/services/SocketManager.ts) — `handleBanPlayerMessage`, where the break is visible

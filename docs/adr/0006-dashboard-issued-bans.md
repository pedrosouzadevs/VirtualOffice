# ADR-0006: Dashboard-issued bans

- **Status:** Accepted
- **Date:** 2026-08-04
- **Deciders:** VirtualOffice team
- **Languages:** this file (en-US) + [0006-dashboard-issued-bans.pt-BR.md](0006-dashboard-issued-bans.pt-BR.md), in lockstep
- **Origin:** [ADR-0005](0005-moderation.md) H3 shipped moderation as read-only screens and discovered that `play`
  ships no ban button. This ADR answers the question that discovery opened. It **revises** ADR-0005 decisions #2 and
  the H3 read-only rule; both carry pointers here.

## Context

P3 repaired the ban pipeline: `POST /api/ban` records, the kick works again, `GET /api/ban` answers. Then the
end-to-end test surfaced what the ADR had assumed away: **no UI in `play` issues a ban.** The video-box menu's
`#kickoff-user` removes somebody from the *meeting*, and `ActionMediaBox.svelte` carries a commented-out `ban()`
marked `TODO: implement ban user`. The only sender of `banPlayerMessage` is the scripting API's `banUser` event.

So a decision was needed: build the missing button in `play`, or make the dashboard — which already lists bans — the
surface that issues them. **The product decision (2026-08-04) is the dashboard.** One moderation surface, next to
the evidence it acts on, behind the session barrier that already re-reads `admin` on every request.

Two code facts make this cheap, and both were verified rather than assumed:

1. **The pusher rejects a connection whose `/api/room/access` answer is not `status: "ok"`.**
   `IoSocketController` refuses the WebSocket upgrade with the error payload, and `AuthenticateController` surfaces
   the same answer during login. The response schema is a union with `ErrorApiData` — we already import it. Answering
   the error variant for a banned identifier closes the door **from our own endpoint, with no `play` change**.
2. **The pusher already has a kick channel for administrations: the `/ws/admin/rooms` WebSocket.** Its
   `user-message`/`banned` branch calls the very `emitBan` that P3's repair re-enabled. It mounts only when
   `ADMIN_SOCKETS_TOKEN` is set — which nothing ever set, so it has been dormant. The JWT it demands is HMAC-signed
   with that same token, and `admin-api` already depends on `jose`.

## Decision 1 — The dashboard is the surface that issues bans

`POST /admin/api/bans` — session + CSRF, like every dashboard mutation. It writes through the same
`banIdentifier` service the pusher's `POST /api/ban` uses, so the two surfaces cannot disagree about what banning
means, and the audit entry names the **logged-in administrator** — better attribution than the pusher path, whose
actor is whatever `byUserUuid` claims.

The commented-out `ban()` in `play` stays commented out. The scripting API's `banUser` event stays: it is `play`'s
own generic surface, and the P3 end-to-end test drives it.

**Lifting a ban stays direct SQL.** Issuing is a moderation action with a clear meaning; lifting still is not (what
happens to the record? to the audit trail?), and P3's reasoning stands: a button would decide that by accident.

## Decision 2 — The door closes at `/api/room/access` (revises ADR-0005 #2)

A banned identifier asking for room access is answered **HTTP 200 with `ErrorApiData`** — `type: "error"`, code
`USER_BANNED`, the stored ban message as the text. The pusher refuses the connection and the login; the front shows
its error screen. A ban therefore **survives reconnection**, which ADR-0005 #2 said plainly it did not.

What #2 actually deferred was "the pusher must call `verifyBanUser` on connect", a `play` change. This is the same
enforcement without that: the check lives inside the endpoint the pusher already calls on every connection.
`verifyBanUser` stays uncalled and `GET /api/ban` stays answerable (ADR-0005 correction #7's trap remains guarded).

Three edges that are the contract, not details:

- **200, never 4xx.** The pusher's axios throws on any non-2xx and substitutes a generic "Connection error" — the
  banned person would lose the message an administrator wrote for them, and the log would blame connectivity.
- **Banned ≠ unknown.** ADR-0002's invariant #9 — an unknown member enters with `tags: []`, never an error — is
  untouched. The ban lookup is a separate, explicit branch.
- **The IP decision is not reopened.** The door reads the identifier only; `ipAddress` stays accepted-and-dropped
  (ADR-0005 #3).

## Decision 3 — The kick rides the pusher's own admin channel, best-effort

On a dashboard ban, `admin-api` connects to `ws://play:3000/ws/admin/rooms`, presents a short-lived HS256 JWT signed
with the shared `ADMIN_SOCKETS_TOKEN`, and sends the `user-message`/`banned` event for the world's rooms. The pusher
runs `emitBan` — the same kick as an in-world ban. Setting `ADMIN_SOCKETS_TOKEN` (never set until now) is what turns
the channel on, for both sides at once, from the same root `.env`.

**Best-effort, by contract.** The ban is the record plus the closed door; the kick is the courtesy of not waiting
for the victim's next reconnection. A kick failure — channel unconfigured, pusher restarting — answers
`kicked: false` to the dashboard and fails nothing. The inverse would let a pusher hiccup un-record a ban.

One pusher quirk is deliberately honoured rather than "fixed": the channel filters rooms by the **sixth segment of
the room URL** (`roomId.split("/")[5] === world`). `admin-api` groups the catalogue's rooms by that same expression
and sends one message per group. It is the pusher's contract; re-deriving it anywhere else would be retyping a
contract by hand.

## Alternatives considered

### A. Implement the ban button in `play` (`ActionMediaBox.ban()`)
- **Pros:** moderation where the administrator already is; upstream's own TODO.
- **Cons:** a second issuing surface with weaker attribution; touches `play`; the dashboard would still need the
  listing anyway.
- **Rejected** by product decision: one surface, the dashboard.

### B. Wire `verifyBanUser` into the pusher's connection flow
- **Pros:** the upstream-shaped fix; makes `GET /api/ban` load-bearing.
- **Cons:** a `play` change on the hot connection path, to obtain enforcement the door already provides from our
  side of the contract.
- **Rejected** as redundant here; it remains the right move if upstream ever wires it themselves.

### C. Record-only dashboard ban (no kick, no door)
- **Rejected** without much ceremony: a ban that neither removes nor keeps out is a lie shaped like a success —
  the same failure class ADR-0005 exists to remove.

### D. A new HTTP kick endpoint on the pusher
- **Rejected:** new surface upstream does not have, when a dormant, purpose-built channel already exists.

## Consequences

### Positive
- A ban now means what everyone assumed in ADR-0005: out now, and stays out. Decision #2's discomfort is retired.
- Bans are issued next to the evidence, with true actor attribution, behind the strongest barrier the system has.
- No `play` code changed. The whole feature is `admin-api` + configuration.

### Negative
- `ADMIN_SOCKETS_TOKEN` becomes a live secret: whoever holds it can kick anyone (not ban — the record needs the
  dashboard). The threat model gains it as an asset.
- The kick couples `admin-api` to a pusher URL-parsing quirk (`split("/")[5]`), pinned by test.
- End-to-end tests that ban must clean the row up, or the door refuses the shared test user in every later suite.

### Neutral
- The dashboard's moderation tab is no longer read-only for bans. Reports remain so entirely.
- The UI note "a ban does not survive reconnection" becomes wrong and is replaced by the opposite statement.

## Mandatory tests

1. `POST /admin/api/bans` requires a session and CSRF; the pusher's `ADMIN_API_TOKEN` does not open it.
2. A dashboard ban writes the audit entry naming the **logged-in** administrator.
3. A banned identifier receives `ErrorApiData` from `/api/room/access` — **HTTP 200**, validating against the very
   `isFetchMemberDataByUuidResponse` union the pusher parses, carrying the stored message.
4. An unknown, non-banned identifier still enters with `tags: []` — invariant #9 survives the door.
5. The ban is normalised: banning `Trouble@Example.COM` closes the door on `trouble@example.com`.
6. A kick failure (or an unconfigured channel) answers `kicked: false` and the ban still lands.
7. The kick message groups rooms exactly by `roomUrl.split("/")[5]` and signs with `ADMIN_SOCKETS_TOKEN`.
8. End to end: an administrator bans from the dashboard; the victim in the world lands on the error screen, and a
   reload keeps them out. The test deletes its ban rows afterwards.

## References

- [ADR-0005 — moderation](0005-moderation.md) — the phase this closes the loop on; revision notes point here
- [ADR-0004 — the dashboard](0004-admin-dashboard.md) — the session barrier and CSRF this reuses
- [`play/src/pusher/controllers/IoSocketController.ts`](../../play/src/pusher/controllers/IoSocketController.ts) —
  the connection refusal and the `/ws/admin/rooms` channel, both verified in code
- [Threat model](../security/threat-model.md) — `ADMIN_SOCKETS_TOKEN` as a new asset

# Spec 0001 — Feature Roadmap (VirtualOffice / WorkAdventure)

- **Status:** Draft (proposed)
- **Date:** 2026-07-23
- **Author:** VirtualOffice team
- **Languages:** [0001-feature-roadmap.pt-BR.md](0001-feature-roadmap.pt-BR.md) (pt-BR) + this file (en-US), kept in lockstep.

## TL;DR

This document specifies four features for the VirtualOffice fork of WorkAdventure:

1. **Animated entity** — a user uploads an animated GIF; the system converts it into a spritesheet and exposes it as a **new type** of animated object, freely placeable via the inline editor.
2. **Azure authentication** — add Azure Entra ID (Microsoft) as a login provider while **keeping** the current provider (dev/mock OIDC) available in parallel.
3. **Admin dashboard & APIs** — implement the Admin API contract (`AdminInterface`) with our own persistence plus an administrator UI for managing members, tags and permissions.
4. **Area owner opens/closes their area** — let the user who owns an **area** (their office inside the shared map) close and reopen it at will (persistent, owner-controlled lock).

**Decided order:** **F4 → F3 → F2 → F1** (revised 2026-07-23). F4 was confirmed **standalone** — ownership stays on the area, with no `admin-api` dependency — and is the cheapest (**S**), so it delivers visible value first. Then the foundation (F3), identity on top of it (F2), and finally F1.

F4's design details are decided and recorded in [ADR-0001](../adr/0001-area-owner-lock.md).

Each non-trivial feature gets its own **ADR** in `docs/adr/` before implementation. All docs are bilingual (project rule). Every bug fix ships with a regression test.

---

## Architecture context (shared)

WorkAdventure is a monorepo of services: `play` (Svelte/Phaser front + pusher WebSocket + room-api), `back` (room state), `map-storage` (maps/assets and editor edits), `messages` (protobuf, the inter-service contract), `libs/*`.

Facts anchoring this spec:

- **Inline editor** writes to the `.wam` file (WA metadata), never the `.tmj` (Tiled). It only works on `/~/` URLs (maps in map-storage).
- **Entities (objects)** are rendered by `play/src/front/Phaser/ECS/Entity.ts`, which **extends `Phaser.GameObjects.Image`** — a static texture, no animation.
- **Animated tiles** exist natively (`GameScene.configureTileAnimations`), but they are grid-bound and painted in Tiled — not a fit for "a free-floating object the user uploads".
- **Authorization (tags):** without an Admin API, tags come exclusively from the OIDC claim (`OPENID_TAGS_CLAIM`, default `tags`). `LocalAdmin.ts` is a stub. When `ADMIN_API_URL` is set, `MAP_EDITOR_ALLOW_ALL_USERS` is ignored — the Admin API takes over.
- **License:** AGPL-3 + Commons Clause. Internal use is free; reselling as a service is not. Factor into any product decision.

---

## Feature 1 — Animated entity (new type)

### Goal

A user uploads an animated GIF in the entity editor; the system automatically turns it into an animated object that runs in-world and is freely placeable (same UX as current entities).

### Non-goals

- Animating map tiles (grid/Tiled).
- A frame-by-frame animation editor in the UI.
- Video support (mp4/webm) in this phase.

### Design decision

Create a **new, parallel entity type** (`AnimatedEntity`) without touching the static `Entity`. Rationale: `Entity` (711 lines) concentrates collision, depth, outline and activation; switching its base class from `Image` to `Sprite` would risk regressions across everything that already works. A parallel type isolates the risk (confirmed as the preference in discussion).

Three layers change:

| Layer | Change |
|---|---|
| **Conversion** (map-storage, new) | On upload: decode the GIF (frames + delays) → assemble a spritesheet PNG → extract metadata (`frameWidth`, `frameHeight`, `frameCount`, durations/`frameRate`). Candidate libs: `sharp` (libvips with GIF support) or `gifuct-js`/`omggif`. |
| **Data model** | New prefab/type in `libs/map-editor/src/types.ts` (zod) with an optional animation block; new protobuf message `UploadAnimatedEntityMessage` (or optional fields on `UploadEntityMessage`) in `messages/protos/`. Migration of the entity collection file. |
| **Rendering** (front) | New class `AnimatedEntity extends Phaser.GameObjects.Sprite`: `load.spritesheet` → `anims.create` → `.play()`. Reuse activation/collision/outline via composition or a shared mixin — without altering the static `Entity`. Respect `localUserStore.getDisableAnimations()`. |

### Alternatives considered

- **Extend `Entity` (Image→Sprite):** rejected — regression risk on static entities.
- **Animated tiles:** rejected — grid-bound, requires Tiled, no upload UX in the editor.
- **iframe/overlay with the GIF:** rejected — an overlay panel, not an in-world object.

### Phased plan

- **P0 — PoC:** render one `AnimatedEntity` with a hardcoded spritesheet in a map. Proves rendering before investing in conversion. *(Quick proof of value.)*
- **P1 — Model + protobuf:** new type, message, migration; save/read from map-storage.
- **P2 — GIF→spritesheet conversion** on upload (map-storage), with limits (max frame count, max dimensions, file size).
- **P3 — Editor UX:** accept `image/gif` in the animated flow, an "animated" toggle, both-sides validation, regression tests.
- **P4 — Docs** bilingual (user and developer).

### Risks

Frame-timing variance across GIFs; spritesheet size/performance (many frames → large texture, WebGL limits); memory; interaction with the "disable animations" mode. Guard rails: frame and dimension caps, with a friendly error (never a 500).

### Estimated effort: **M–L**

---

## Feature 2 — Azure authentication (keep both providers)

### Goal

Allow login via Azure Entra ID (Microsoft) while **keeping** the current OIDC provider (mock in dev) available.

### Technical reality

`OpenIDClient` (`play/src/pusher/services/OpenIDClient.ts`) resolves a **single** issuer (`Issuer.discover(OPID_CLIENT_ISSUER)`, cached in `issuerPromise`). Azure Entra is OpenID Connect compliant, so:

- **Switching** to Azure is essentially **configuration** (point the `OPENID_CLIENT_*` env vars at the Azure tenant).
- **Keeping both at the same time** requires **multi-provider** support — not native. This is a code change (registry of N clients, provider selection through the flow and on the login screen).

### Critical point: tag mapping

Azure **does not emit** a `tags` claim by default. For `admin`/`editor` to reach WA, you must map Entra **App Roles** or **groups** to the claim configured in `OPENID_TAGS_CLAIM`. That mapping is the real integration work, not the login itself.

### Design options

| Option | Description | Status |
|---|---|---|
| **A — Config swap** | Point OIDC at Azure. Dev keeps the mock; prod uses Azure. | ✅ **CHOSEN** |
| **B — Multi-provider** | Refactor `OpenIDClient` to hold N clients by `providerId`; picker on the login screen. | ❌ **Out of scope** |

**Decision (2026-07-23):** adopt **Option A**. The two providers do **not** need to coexist in the same environment: during the transition **dev = mock / prod = Azure** applies, and **once F3 is complete the mock is retired, leaving Azure only**.

Relevant consequence: multi-provider (Option B) — the expensive item in this feature — **leaves the scope**. Effort drops from L to S, and the work concentrates on tag mapping, below.

### Phased plan

- **P0** — Azure config-swap validated in staging (end-to-end login).
- **P1** — Map Entra App Roles/groups → tags claim, with tags then resolved by `admin-api` (F3).
- **P2** — **Retire the mock**: once F3 is complete, remove `oidc-server-mock` from the environments and keep Azure only. Document the rollback procedure.

### Risks

Claim-shape differences; Azure v2 endpoints; non-native tags claim; app-registration secret rotation. **Secrets always in a vault**, never in versioned `appsettings`/`.env`.

⚠️ **Risk of retiring the mock (P2):** without the mock there is no offline local login — the development environment starts depending on the Azure tenant (and connectivity). Before P2, decide whether dev keeps the mock permanently or whether a development Azure tenant will exist.

### Estimated effort: **S** (config-swap; multi-provider out of scope)

---

## Feature 3 — Admin dashboard & APIs

### Goal

An administrator UI + backend to manage members, tags/permissions and rooms — i.e., implement the `AdminInterface` contract with our own persistence, making permission changes manageable inside the product.

### Technical reality

`play` has **no user database**. Without an Admin API, tags come only from the OIDC token — nowhere to persist a permission assigned via a screen. A real dashboard = building the "admin" component the SaaS has, in-house:

- New **`admin-api`** service (Clean Architecture: Domain → Application → Infrastructure/API) implementing the endpoints the pusher expects (the Swagger at `play.workadventu.re/swagger-ui/` and the `play/src/pusher/services/AdminInterface.ts` interface).
- **PostgreSQL** persistence (members, tags, worlds, rooms, bans).
- Wiring: the pusher calls `admin-api` via `ADMIN_API_URL` + Bearer `ADMIN_API_TOKEN` (respond 403 if unauthenticated).
- Dashboard: a separate front (e.g. Next.js) authenticated for admins only.

### Core endpoints (from `AdminInterface`)

`/api/map` (maps URL→map and decides access), `/api/room/access` (member data/authorization in the room), `/api/woka/list` (avatars), plus `fetchMemberDataByUuid/ByToken`, `banUserByUuid`, `reportPlayer`, `saveName/saveTextures/saveCompanionTexture`, `getCapabilities`, `searchMembers/searchTags`, `getMember`, `getUrlRoomsFromSameWorld`. Tag/permission management (member CRUD + tag assignment) is what makes `canEdit` and area rights actually work.

### Relationship to the other features

- **F2 provides identity (AuthN); F3 provides authorization (AuthZ).** Clean split: Azure says *who you are*; `admin-api` says *what you can do*.
- With `ADMIN_API_URL` set, `MAP_EDITOR_ALLOW_ALL_USERS` is ignored — `admin-api` controls the editor. This feature **supersedes** the env-var approach.
- **F4 depends** on this to persist room ownership and lock state.

### Phased plan

- **P0 — Minimal viable:** `admin-api` implementing only the 3 core endpoints (`/api/map`, `/api/room/access`, `/api/woka/list`) served from Postgres, wired to the pusher. Login and map keep working.
- **P1 — Members + tags:** member CRUD and tag assignment + dashboard UI.
- **P2 — Moderation:** ban/report, search, worlds.
- **P3 — Hardening:** audit log, RBAC on the dashboard itself, STRIDE threat model.

### Risks

Must satisfy the **exact** contract the pusher expects (the Swagger) — divergence breaks login/map. It is the largest feature. Security: `admin-api` holds identity/authorization → threat model mandatory. Mind the license (AGPL + Commons Clause).

### Estimated effort: **L–XL**

---

## Feature 4 — Area owner opens/closes their area

> **Scope correction (2026-07-23):** the initial version of this spec assumed "room" = its own map/URL. **That is wrong.** Here, a "room" is an **area inside a single map**, and each user owns their own. This changes the implementation layer and **significantly reduces** the effort — most of it already exists as primitives.

### Goal

The user who owns an **area** (their virtual office inside the shared map) can **close** and **reopen** that area at will — a **persistent** lock, controlled by the owner.

### Technical reality — three primitives that already exist

| Primitive | What it already does | What is missing |
|---|---|---|
| **Personal area** (`personalAreaPropertyData`) | Already is exactly "each user owns their area": it has `ownerId`, and `accessClaimMode` `dynamic` (claim by walking through, tag-gated) or `static` (assigned owner). Documented as *"the user's virtual office space"*. | Nothing — **ownership already exists**. |
| **Lockable area** (`lockableAreaPropertyData`) | Lock/unlock blocking entry by collision at the boundary; whoever leaves cannot re-enter while locked. | It is **ephemeral** (auto-unlocks when empty) and controlled by **anyone inside**, not the owner. |
| **Area property variables** (`areaPropertyVariableMessage`) | Per area+property state, server-synced to all clients. **The current lock state already lives here** (see comment in `types.ts:216`). | Nothing — it is **ready-made persistence**. |

**Conclusion:** F4 is not about building a lock from scratch. It is about **marrying the two existing area properties** — ownership (personal area) + lock (lockable area) — switching the semantics from *ephemeral/anyone* to *persistent/owner-only*.

### Design decision

| Aspect | Proposal |
|---|---|
| **Who is "owner"** | The **personal area**'s `ownerId`, which already exists. ⚠️ *See "Revisiting decision #4" below.* |
| **Lock state** | An **area property variable** (the mechanism the current lock already uses), with **persistent** semantics — no auto-unlock when empty. |
| **Who can lock** | **Only the area owner** (today it is anyone inside, optionally tag-gated). |
| **UI** | A "Close/Open my area" control for the owner — same family as the lock button that already appears in the action bar when entering a lockable area. |
| **Admin override** | ✅ **Decided: no.** Administrators do not bypass the lock. |
| **Those already inside** | ✅ **Decided: they stay.** Closing blocks new entrants; it evicts nobody. |

### ⚠️ Decision #4 needs revisiting

Decision #4 stated ownership would come from **`admin-api` (F3)**, making F3 a hard prerequisite. With "room = area", this **must be revisited**: the personal area **already persists `ownerId`**, and `dynamic` mode lets the user claim the area on their own, **without** `admin-api`.

Two possible readings — **decide in the ADR**:

- **(a) Standalone:** ownership stays on the area (as today). F4 **stops depending on F3** and can be done at any time. Cheaper and faster.
- **(b) Via `admin-api`:** F3 becomes the source of truth for ownership (useful if you want to assign/revoke areas from the dashboard, with auditing). Keeps the dependency.

*Recommendation: (a) to ship, (b) as an evolution — the dashboard can manage ownership later without blocking the feature now.*

### Semantics of "closing"

Closing ≠ emptying. A closed area is an **entry gate**: those inside remain until they leave; those outside cannot get in.

### Behavior while the area is closed (decided 2026-07-23)

For anyone who is **not the owner**:

| Situation | Behavior |
|---|---|
| Inside and wants to leave | **"Leave area"** button → avatar moved outside the area bounds |
| Connection dropped, returns **within** N minutes | **Re-enters normally** (grace period valid) |
| Connection dropped, returns **after** N minutes | Is **moved outside** the area |
| Never was inside | Blocked at the boundary (collision), as the current lock already does |

With the area **open**, none of this applies.

#### ❌ `RoomRedirect` does **not** apply here

The previous version of this spec proposed `RoomRedirect` for "teleporting out". **Dropped:** `RoomRedirect` moves the user to a different **map/URL**, whereas here the user must stay in the **same map**, merely outside the area bounds. The correct mechanism is **repositioning the avatar** within the map (same family as what the lock's collision already does when blocking), not a room redirect.

#### Grace tracking

A token per **user + area** with a TTL of N minutes. Since area state already travels via area property variables, the grace period can live on the same path (or in Redis, via the back). Issued to those inside when the area closed.

#### To define in the ADR

- **The "outside" position** — where is the avatar moved to? Candidates: nearest point outside the boundary, or a configurable "exit" position on the area. *(Far simpler than the multi-map case: it is a coordinate in the same map.)*
- **Value of N** and whether it is configurable.
- Coexistence of `lockableAreaPropertyData` (ephemeral, existing) with the new persistent owner lock: **extend the current property with a mode** or create a new property? *(Prefer extending, to avoid duplicating the concept.)*

### Phased plan

- **P0** — Define the ownership source (revisit decision #4) and the persistent lock model.
- **P1** — Persistent lock via area property variable, restricted to the owner (no auto-unlock).
- **P2** — "Close/Open my area" UI for the owner.
- **P3** — Grace period + avatar repositioning + "Leave area" button.
- **P4** — (If reading (b)) ownership management via the F3 dashboard.
- **P5** — Regression tests: new entrant blocked, those inside remain, admin **cannot** enter, reconnection within/after the grace period, "Leave" button repositions, and **the lock does not dissolve when empty** (the core difference from the current lock).

### Risks

Do not break the **existing ephemeral lock**, which is another feature in use — if we extend the same property, the current mode must keep working (regression test mandatory). The **permanent lockout** risk (owner disappears with the area closed) remains: mitigate with ownership reassignment — which the personal area **already supports** ("revoke access" from the editor, see the personal area doc), without needing F3.

### Estimated effort: **S** (revised down — previously S–M under the wrong room=map design; the three core primitives already exist)

---

## Sequencing and dependencies

```
F4 (owner area lock) ── standalone, no dependencies  [1st]  ← ADR-0001
F3 (admin-api) ──► AuthZ foundation                  [2nd]
      └── F2 wires Azure identity on top of F3;
             once F3 is complete, mock retired       [3rd]
F1 (animated entity) ── independent, no dependencies [4th]
```

**Decided order: F4 → F3 → F2 → F1.**

Reason: F4 was confirmed **standalone** (ownership on the area, no `admin-api`) and is the cheapest item in the roadmap — ownership, lock, persistence and repositioning already exist as primitives. It delivers perceivable value early. Then F3, the authorization foundation and the destination of F2's tag mapping; then F2; and F1 last, with no blocking risk since it depends on nothing.

**Order history:** the spec initially suggested F1 → F3 → F2 → F4; then F3 → F2 → F4 → F1 was decided (foundation first), whose weak point was deferring all visible value until F3. F4's scope correction (room = **area**, not map) made it cheap and independent, resolving that weak point — hence the current order.

## Cross-cutting items (project standard)

- **One ADR per feature** in `docs/adr/` before coding (F1, F3, and F2's multi-provider deserve ADRs).
- **Bilingual docs** (en-US + pt-BR) in lockstep.
- **Testing**: unit + integration; regression mandatory per bug fix; a GIF-conversion eval harness (F1) with labeled cases.
- **Security**: STRIDE threat model for F2/F3/F4; secrets in a vault; PII tagged and redacted in logs.
- **Observability**: structured logs, metrics and tracing on external calls (pusher↔admin-api, GIF conversion).

## Decisions taken (2026-07-23)

| # | Question | Decision | Impact |
|---|---|---|---|
| 1 | **F1** — GIF conversion on server or client? | **On the server (map-storage)** | Central control of limits (frames, dimensions, size) and consistency across clients. |
| 2 | **F2** — do both providers coexist in the same environment? | **No.** Dev = mock / prod = Azure; **once F3 is complete, Azure only** | Multi-provider leaves the scope. F2 effort drops from **L to S**. |
| 3 | **F3** — dedicated PostgreSQL for `admin-api`? | **Yes, approved** | No corporate database/IdP integration in this phase. |
| 4 | **F4** — source of area "ownership"? | ✅ **RESOLVED: it stays on the area (standalone).** Uses `personalAreaPropertyData`'s `ownerId`, no `admin-api` | F4 **stops depending on F3** and was promoted to first in the queue. Details in [ADR-0001](../adr/0001-area-owner-lock.md). |
| 5 | Execution order | ✅ **REVISED: F4 → F3 → F2 → F1** | F4 became standalone and cheap (S), so it delivers visible value first; see *Sequencing*. |
| 6 | **F4** — do admins override the owner's lock? | **No** | Sovereign lock. Creates permanent-lockout risk → mitigate with owner reassignment. |
| 7 | **F4** — those already inside when it closes? | **They stay** | Closing blocks new entrants; evicts nobody. |
| 8 | **F4** — reconnection and leaving (closed area) | **"Leave area"** button moves the user out; a dropped connection gets an **N-minute grace period** (return within → re-enters; return after → moved out) | Avatar repositioning **within the same map** (`RoomRedirect` was dropped — it changes map). Still to define: the **exit position** and the value of **N**. |
| 9 | **F4** — scope of "room" | **An area inside a single map**, not its own map | Premise correction. F4 effort drops to **S**; three core primitives already exist. |

## Remaining open items

1. **F2/P2** — does the development environment keep the mock permanently, or will there be a dev Azure tenant? (decide before retiring the mock)
2. **F3** — `admin-api` data model: confirm entities and relationships (members, tags, worlds, rooms, bans) in the ADR.
3. ~~**F4** — ownership source, exit position, value of N, extend vs. new property, door art~~ → **all resolved** in [ADR-0001](../adr/0001-area-owner-lock.md). No art dependency: procedural walls with a standardized south opening. **No pending point blocks the start.**

## Next artifacts

- **F3 ADR** (`docs/adr/`) — `admin-api` design: contract, data model, authentication, phasing. This is the next document to write.
- F1 ADR when the queue reaches it.

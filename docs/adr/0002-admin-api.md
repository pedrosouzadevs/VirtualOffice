# ADR-0002: Our own Admin API (`admin-api`) for members, tags and permissions

- **Status:** Proposed
- **Date:** 2026-07-29
- **Deciders:** VirtualOffice team
- **Languages:** [0002-admin-api.pt-BR.md](0002-admin-api.pt-BR.md) (pt-BR) + this file (en-US), in lockstep.
- **Source spec:** [Spec 0001 — Feature Roadmap](../specs/0001-feature-roadmap.md), Feature 3.

## Context

Today `play` has **no user database**. Without an Admin API, tags (`admin`, `editor`, …) come exclusively from the OIDC claim — there is nowhere to persist a permission assigned through a screen. That is precisely the blocker that started this roadmap: *"I can't fix the tags"*.

The pusher already knows how to talk to an Admin API: when `ADMIN_API_URL` is set, it stops using the [`LocalAdmin.ts`](../../play/src/pusher/services/LocalAdmin.ts) stub and issues HTTP calls via [`AdminApi.ts`](../../play/src/pusher/services/AdminApi.ts). **We do not get to choose the contract — it already exists.** Our job is to implement the other side of it.

> ⚠️ **Central risk of this feature:** the contract is consumed at runtime with `zod` validation. A missing field or wrong type on `/api/map` or `/api/room/access` **breaks login and map loading**. This ADR therefore documents the contract **as verified in the code**, not as documented (the docs are incomplete).

### Important side effect

With `ADMIN_API_URL` set, `MAP_EDITOR_ALLOW_ALL_USERS` is **ignored** — `admin-api` takes over map-editor access. In other words: **the day we turn `admin-api` on, today's env-var configuration stops applying.** `canEdit` starts coming from our response.

## Verified contract (source: `AdminApi.ts`)

### Authentication — the first trap

```
Authorization: <ADMIN_API_TOKEN>
```

The token is sent **raw, with no `Bearer` prefix** (`headers: { Authorization: \`${ADMIN_API_TOKEN}\` }`). A server requiring `Bearer <token>` rejects every call. `Accept-Language` is also sent, carrying the user's locale.

### Endpoints

| Endpoint | Method | Criticality | Role |
|---|---|---|---|
| `/api/capabilities` | GET | **Negotiation** | Returns supported capabilities. **404 is acceptable** — the pusher falls back to the default set. This is what makes phased delivery possible. |
| `/api/map` | GET | 🔴 **Blocking** | `?playUri&userId?&accessToken?` → `MapDetailsData` \| `RoomRedirect` \| `ErrorApiData`. Without it, no map loads. |
| `/api/room/access` | GET | 🔴 **Blocking** | `?userIdentifier&playUri&ipAddress&characterTextureIds&companionTextureId&accessToken&isLogged&chatID` → member data (includes `tags` and `canEdit`). Without it, nobody enters. |
| `/api/woka/list` | GET | 🔴 **Blocking** | The world's avatar (Woka) list. |
| `/api/companion/list` | GET | 🟡 | Companion list. |
| `/api/members`, `/api/members/{uuid}` | GET | 🟡 | Member search and detail. |
| `/api/world/tags`, `/api/room/tags` | GET | 🟡 | Available tags (feeds the editor's pickers). |
| `/api/ban`, `/api/report` | GET/POST | 🟡 | Moderation. |
| `/api/save-name`, `/api/save-textures`, `/api/save-companion-texture` | POST | ⚪ Optional | Capability-gated. |
| `/api/room/same`, `/api/chat/members`, `/api/login-url/{token}` | GET | ⚪ Optional | Worlds, chat, token login. |

### Response shapes (exact fields)

**`/api/room/access`** → `status: "ok"` plus:
```
email, username?, userUuid, tags[], visitCardUrl,
isCharacterTexturesValid, characterTextures, isCompanionTextureValid, companionTexture,
messages, userRoomToken, activatedInviteUser, applications, canEdit, world, chatID, canRecord
```
`canEdit` is the field that **unlocks the map editor** — this is where tag management becomes a practical effect.

**`/api/map`** → `MapDetailsData` (~45 fields: `mapUrl`, `wamUrl`, `group`, `authenticationMandatory`, `editable`, `enableChat*`, `metatags`, `modules`, …), **or** `RoomRedirect` (`{ redirectUrl }`), **or** `ErrorApiData`.

> The sheer size of `MapDetailsData` is why P0 below exists: getting that payload right is half the integration work.

## Decision

### 1. New `admin-api` service, Clean Architecture, dedicated PostgreSQL

Domain → Application → Infrastructure/API. Its own Postgres (spec decision #3), no corporate-database integration in this phase.

### 2. Phasing driven by capabilities

`/api/capabilities` allows **incremental delivery without breaking `play`**: implement the blocking core first and declare only what exists.

### 3. Separate dashboard

Its own front (Next.js), authenticated for admins only, consuming `admin-api`'s own API — **not** the endpoints the pusher uses.

### 4. Contract before features

P0 is a "skeleton that answers correctly": the 3 blocking endpoints served from Postgres, with `play` working end to end. Only then members/tags/UI.

### 5. Member identity: internal PK + external identifiers (decided 2026-07-29)

**Constraint verified in the code:** the pusher uses the **email** as the identifier. In [`AuthenticateController.ts:318`](../../play/src/pusher/controllers/AuthenticateController.ts) it calls `createAuthToken(email, …)`, and `JWTTokenManager` documents the field as *"will be a email if logged in or an uuid if anonymous"*. `OpenIDClient` **does** hold the `sub`, but **never forwards it**. So the `userIdentifier` arriving at `/api/room/access` is the email.

Consequence: **keying the table on the OIDC `sub` is not viable** without patching the pusher — and patching it would create upstream divergence on every merge.

**Decision (answering "whatever is best for Azure later"):**

```
member
  id          uuid  PK      -- ours, internal; never an external identifier
  email       text  UNIQUE  -- lookup key (this is what the pusher sends)
  oidc_sub    text  UNIQUE NULL  -- filled when available; ready for Azure
  ...
```

Rationale: the value `sub` would bring — surviving an email change without losing tags and area ownership — is delivered by the **internal PK**. If someone's email changes, we update the column and everything else (tags, areas, bans) keeps pointing at the same `id`. `oidc_sub` stands ready for F2: when Azure lands, we store the `oid`/`sub` on first login (linking via the existing email account), giving us the option to migrate the lookup later with no data migration.

What **not** to do: use the email as a foreign key in other tables. That is the mistake that makes an email change painful.

### 6. First-admin bootstrap: idempotent seed (decided 2026-07-29)

The first administrator comes from an **idempotent seed** (`ON CONFLICT DO NOTHING`, the project pattern), with the email supplied by an environment variable (e.g. `ADMIN_API_BOOTSTRAP_ADMIN_EMAIL`) so it is neither hardcoded nor committed. It runs on `admin-api` startup; if the member already exists, nothing happens.

Accepted alternative for development: a manual `INSERT` in Postgres.

### 7. Single world in P0 (decided 2026-07-29)

The `world` field exists in the `/api/room/access` response and will be returned as a **fixed** value in P0. No `world` table and no per-world relationships for now.

Why this does not become a trap: `world` stays part of the response from day one (the contract does not change when multi-world arrives), and tags are already per-member. Introducing worlds later means adding a table and scoping tags — not rewriting the model.

## Alternatives considered

### A. Keep going without an Admin API (env vars)
- **Pros:** zero work.
- **Cons:** it is exactly the blocker that started the roadmap — tags only via the OIDC claim, nothing manageable.
- **Rejected.**

### B. Subscribe to the SaaS (`admin.workadventu.re`)
- **Pros:** ready-made, maintained by them.
- **Cons:** per-seat cost, data off-site, no customization; and F5 (ejection) plus F4's owner mode are **ours**, they don't exist there.
- **Rejected** for this context, but it is the functionality *benchmark*.

### C. Extend `play` with an embedded database
- **Pros:** one less service.
- **Cons:** fights the upstream architecture (the pusher is stateless by design) and creates painful divergence on every upstream merge.
- **Rejected.**

## Consequences

### Positive
- Unblocks the original problem: tags and permissions manageable from a screen.
- Becomes the foundation for **F2** (Azure provides identity; `admin-api` provides authorization) and lets **F5** move area ownership to central management.
- Enables worlds, moderation and `/@/` URLs.

### Negative
- **Largest feature in the roadmap** (L–XL) and a service to maintain forever.
- **Security surface:** it will hold identity and authorization → STRIDE threat model mandatory, auditing, secrets in a vault.
- Contract divergence = broken login. Mitigation: contract tests from P0 on.

### Neutral
- `MAP_EDITOR_ALLOW_ALL_USERS` and friends leave the stage.
- AGPL-3 + Commons Clause still applies (internal use free; reselling as a service, no).

## Implementation plan

| Phase | Scope |
|---|---|
| **P0 — Skeleton that answers correctly** | `admin-api` + Postgres + the 3 blocking endpoints (`/api/map`, `/api/room/access`, `/api/woka/list`) + `/api/capabilities` declaring the minimum. Goal: `ADMIN_API_URL` on and `play` working exactly as today. |
| **P1 — Members and tags** | Member CRUD, tag assignment, `canEdit` derived from tags. Endpoints `/api/members*`, `/api/world/tags`, `/api/room/tags`. |
| **P2 — Dashboard** | Admin UI: list/search members, assign tags, view rooms. |
| **P3 — Moderation** | `/api/ban`, `/api/report`, worlds, `/api/room/same`. |
| **P4 — Hardening** | Audit log, RBAC on the dashboard itself, STRIDE threat model, secret rotation. |

### Mandatory tests

1. **Contract test** per blocking endpoint: the response validates against the very same `zod` schema the pusher uses (`isMapDetailsData`, `isFetchMemberDataByUuidSuccessResponse`). *Reuse the schemas from `@workadventure/messages` — do not retype them.*
2. End-to-end login with `ADMIN_API_URL` on.
3. `canEdit` true/false according to the member's tags.
4. A missing `/api/capabilities` (404) does not take `play` down.
5. Wrong token → 403 on every endpoint.

## Points confirmed (2026-07-29)

1. ✅ **Identity** — internal PK + `email` as the lookup key + `oidc_sub` staged for Azure (decision #5). Keying on `sub` alone is not viable: the pusher does not send it.
2. ✅ **Bootstrap** — idempotent seed with the first admin's email from an env var (decision #6).
3. ✅ **Worlds** — single world in P0; `world` returned as a fixed value (decision #7).

No pending point blocks the start of P0.

## References

- [`play/src/pusher/services/AdminApi.ts`](../../play/src/pusher/services/AdminApi.ts) — **the contract's source of truth**
- [`play/src/pusher/services/AdminInterface.ts`](../../play/src/pusher/services/AdminInterface.ts) — TypeScript interface
- [`play/src/pusher/services/LocalAdmin.ts`](../../play/src/pusher/services/LocalAdmin.ts) — default behaviour with no Admin API
- [Official doc: implement your own Admin API](../others/self-hosting/adminAPI.md)
- Reference Swagger: `https://play.workadventu.re/swagger-ui/`
- [Spec 0001 — Roadmap](../specs/0001-feature-roadmap.md) (Feature 3)

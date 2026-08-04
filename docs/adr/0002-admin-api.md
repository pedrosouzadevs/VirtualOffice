# ADR-0002: Our own Admin API (`admin-api`) for members, tags and permissions

- **Status:** Accepted
- **Date:** 2026-07-29 — contract re-verified against the code on 2026-07-30 (see *Corrections*)
- **Deciders:** VirtualOffice team
- **Languages:** [0002-admin-api.pt-BR.md](0002-admin-api.pt-BR.md) (pt-BR) + this file (en-US), in lockstep.
- **Source spec:** [Spec 0001 — Feature Roadmap](../specs/0001-feature-roadmap.md), Feature 3.

## Context

Today `play` has **no user database**. Without an Admin API, tags (`admin`, `editor`, …) come exclusively from the OIDC claim — there is nowhere to persist a permission assigned through a screen. That is precisely the blocker that started this roadmap: *"I can't fix the tags"*.

The pusher already knows how to talk to an Admin API: when `ADMIN_API_URL` is set, it stops using the [`LocalAdmin.ts`](../../play/src/pusher/services/LocalAdmin.ts) stub and issues HTTP calls via [`AdminApi.ts`](../../play/src/pusher/services/AdminApi.ts). **We do not get to choose the contract — it already exists.** Our job is to implement the other side of it.

> ⚠️ **Central risk of this feature:** the contract is consumed at runtime with `zod` validation. A missing field or wrong type on `/api/map` or `/api/room/access` **breaks login and map loading**. This ADR therefore documents the contract **as verified in the code**, not as documented (the docs are incomplete).

### Important side effect — and it is far wider than one variable

With `ADMIN_API_URL` set, `MAP_EDITOR_ALLOW_ALL_USERS` is **ignored** — `admin-api` takes over map-editor access. In other words: **the day we turn `admin-api` on, today's env-var configuration stops applying.** `canEdit` starts coming from our response.

That is not one variable, it is **40** (verified 2026-07-30). [`LocalAdmin`](../../play/src/pusher/services/LocalAdmin.ts) builds its two payloads out of `play`'s environment:

| Consumer | Count | Examples |
|---|---|---|
| `fetchMapDetails` → `/api/map` | **28** | `START_ROOM_URL`, `PUBLIC_MAP_STORAGE_URL`, `DISABLE_ANONYMOUS`, `ENABLE_CHAT*` (4), `ENABLE_SAY`, `ENABLE_ISSUE_REPORT`, `MATRIX_*` (5), `DEFAULT_WOKA_*` (2), `PROVIDE_DEFAULT_WOKA_*` (2), `SKIP_CAMERA_PAGE`, `BYPASS_PWA`, `ENABLE_TUTORIAL`, `OPID_WOKA_NAME_POLICY`, `LIVEKIT_RECORDING_S3_*` (5) |
| `fetchMemberDataByUuid` → `/api/room/access` | **+12** | `MAP_EDITOR_ALLOW_ALL_USERS`, `MAP_EDITOR_ALLOWED_USERS`, and the 10 application flags (`KLAXOON_ENABLED`, `YOUTUBE_ENABLED`, `GOOGLE_*_ENABLED` ×4, `ERASER_ENABLED`, `EXCALIDRAW_ENABLED`, `CARDS_ENABLED`, `TLDRAW_ENABLED`) |

Once those two endpoints are ours, all 40 are read from **`admin-api`'s** environment and `play`'s copies become dead configuration for those fields. Duplicating them across two `.env` files means they diverge silently, and the failure mode is not an error — it is *"the chat disappeared after we turned on admin-api"*.

**Decision:** `docker-compose.yaml` has no `env_file`; it interpolates each variable from the repository-root `.env` (e.g. `ENABLE_MAP_EDITOR: "$ENABLE_MAP_EDITOR"`). The `admin-api` service declares **the same variables interpolated from that same root `.env`** — one value, two consumers, no new mechanism. Variables that are genuinely `admin-api`-only take the `ADMIN_API_` prefix.

## Verified contract (source: `AdminApi.ts`)

### Authentication — the first trap

```
Authorization: <ADMIN_API_TOKEN>
```

The token is sent **raw, with no `Bearer` prefix** (`headers: { Authorization: \`${ADMIN_API_TOKEN}\` }`). A server requiring `Bearer <token>` rejects every call. `Accept-Language` is also sent, carrying the user's locale.

**Exception — `/api/capabilities` carries no token at all** (verified 2026-07-30). [`AdminApi.ts:208`](../../play/src/pusher/services/AdminApi.ts) issues `axios.get(ADMIN_API_URL + "/api/capabilities")` with **no request config**: no headers, no `Authorization`. Every other endpoint passes one.

So the token guard must exempt that path. Answering it with 403 throws inside `initialise()`, which retries forever — the pusher hangs exactly as it does on a 404 (Trap #2), just through a different door. Mount the guard so everything under `/api` is protected **by default** and opening a path is a deliberate act, then exempt this one.

### Endpoints

| Endpoint | Method | Criticality | Role |
|---|---|---|---|
| `/api/capabilities` | GET | 🔴 **Blocking** | Returns supported capabilities. ⚠️ **A 404 hangs the pusher** — see Trap #2. Answering `200 {}` is valid and is what makes phased delivery possible. |
| `/api/map` | GET | 🔴 **Blocking** | `?playUri&userId?&accessToken?` → `MapDetailsData` \| `RoomRedirect` \| `ErrorApiData`. Without it, no map loads. |
| `/api/room/access` | GET | 🔴 **Blocking** | `?userIdentifier&playUri&ipAddress&characterTextureIds&companionTextureId&accessToken&isLogged&chatID` → member data (includes `tags` and `canEdit`). Without it, nobody enters. |
| `/api/woka/list` | GET | 🟡 **In P0 anyway** | Not blocking on its own — it is capability-gated. But `/api/room/access` forces us to own the Woka catalogue regardless: see Trap #3. |
| `/api/companion/list` | GET | 🟡 | Companion list. |
| `/api/members`, `/api/members/{uuid}` | GET | 🟡 | Member search and detail. |
| `/api/world/tags`, `/api/room/tags` | GET | 🟡 | Available tags (feeds the editor's pickers). |
| `/api/ban`, `/api/report` | GET/POST | 🟡 | Moderation. |
| `/api/save-name`, `/api/save-textures`, `/api/save-companion-texture` | POST | ⚪ Optional | Capability-gated. |
| `/api/room/same`, `/api/chat/members`, `/api/login-url/{token}` | GET | ⚪ Optional | Worlds, chat, token login. |

### Trap #2 — a 404 on `/api/capabilities` hangs the pusher (verified 2026-07-30)

The official documentation, and the first draft of this ADR, said a 404 was acceptable. **The code says otherwise:**

- [`AdminApi.ts:161`](../../play/src/pusher/services/AdminApi.ts) — `queryCapabilities` catches **any** exception (a 404 included: there is no custom `validateStatus`, so axios rejects on it) and reschedules itself via `setTimeout` with **no retry cap**. The enclosing promise never settles.
- [`app.ts:193`](../../play/src/pusher/app.ts) — `await adminApi.initialise()` runs inside `init()`. The surrounding `try/catch` never fires: the promise does not reject, it simply never resolves.
- [`server.ts:52`](../../play/src/server.ts) — `await app.init()` runs **before** `listenWebServer`.

Consequence: with `ADMIN_API_URL` set and `/api/capabilities` answering 404, the pusher retries forever and **never opens its HTTP/WS port**. It does not crash, and it logs one warning — it hangs. The 404 tolerance only holds when `ADMIN_API_URL` is empty, because then the call is never made.

So `/api/capabilities` is the **most** blocking endpoint of the three, not an optional negotiation. What enables phased delivery is answering **`200` with an empty object** — declaring no capability at all is perfectly valid.

### Trap #3 — `characterTextures` pulls the Woka catalogue into P0 (verified 2026-07-30)

`/api/woka/list` is **not** blocking on its own: [`WokaService.ts:10`](../../play/src/pusher/services/WokaService.ts) selects `adminWokaService` only when `capabilities["api/woka/list"] === "v1"`; otherwise the pusher keeps serving its local catalogue. The same gating applies to `/api/companion/list`.

But `/api/room/access` must return `characterTextures` — the `WokaDetail[]` resolved from the `characterTextureIds` it receives — together with `isCharacterTexturesValid`. An empty array or a false flag sends the user to the Woka selection page. `LocalAdmin` resolves this through [`LocalWokaService`](../../play/src/pusher/services/LocalWokaService.ts), which reads `play/src/pusher/data/woka.json`.

So `admin-api` needs the catalogue either way. If we skip `/api/woka/list`, the pusher serves the list from `play`'s copy while we validate against ours — two sources of truth, whose divergence shows up as a **login loop**: the user is bounced to Woka selection, picks a texture we do not know, and is bounced again.

**Decision: implement `/api/woka/list` in P0**, serving the very catalogue used for texture resolution. The original ADR reached the right conclusion for the wrong reason — it is in P0 because of `/api/room/access`, not because the endpoint is blocking.

### Response shapes (exact fields)

**`/api/room/access`** → exactly **10 required** fields ([`AdminApi.ts:58`](../../play/src/pusher/services/AdminApi.ts)):
```
status ("ok"), email (nullable), userUuid, tags[], visitCardUrl (nullable),
isCharacterTexturesValid, characterTextures[], isCompanionTextureValid,
messages[], world
```
Optional: `username`, `companionTexture`, `userRoomToken`, `activatedInviteUser`, `applications`, `canEdit`, `chatID`, `canRecord`.

Note the irony: **`canEdit` is optional in the schema** (`z.boolean().nullable().optional()`) and yet it is the field that **unlocks the map editor** — where tag management becomes a practical effect. Omitting it is silently falsy, which is exactly the bug we would ship without noticing.

#### `userUuid` must echo the identifier, not our internal id (verified 2026-07-30)

Returning `member.id` here would look like the tidy thing to do. It would **break F4**, which is already shipped.

The chain: `ConnectionManager` builds the front's local user from this field (`new LocalUser(data.userUuid, data.email)`), and the map editor writes that value into `personalAreaPropertyData.ownerId` when someone claims a personal area ([`MapEditorModeManager.ts:557`](../../play/src/front/Phaser/Game/MapEditor/MapEditorModeManager.ts)). Every area claimed so far therefore holds the **email**. Switch `userUuid` to an internal uuid and every one of them is orphaned — nobody owns their office any more.

Decision #5 says the same thing from the other side: the internal primary key is **never** an external identifier. It stays inside the database.

#### The pusher stops sending OIDC tags

`AdminApi.fetchMemberDataByUuid` accepts a `tags` argument but **does not put it in the query string** ([`AdminApi.ts:419`](../../play/src/pusher/services/AdminApi.ts)). So from the moment `ADMIN_API_URL` is set, tags come from us and nowhere else — which is precisely the point of the feature, and also why `canEdit` must **not** honour `MAP_EDITOR_ALLOW_ALL_USERS` or `MAP_EDITOR_ALLOWED_USERS`. Reproducing them would put authorisation back into an environment variable nobody can change through a screen. `ENABLE_MAP_EDITOR` is still honoured: it is a global kill switch, not an authorisation rule.

> ⚠️ **Migration consequence:** on the day `ADMIN_API_URL` is switched on, anyone who had `admin`/`editor` through the OIDC claim but has no member row loses map-editor access until they are granted it. That is what the bootstrap of decision #6 exists for.

**`/api/map`** → `MapDetailsData`, **or** `RoomRedirect` (`{ redirectUrl }`), **or** `ErrorApiData`.

`MapDetailsData` requires **exactly one** field: `group` (`z.string().nullable()`, so `null` passes) — [`MapDetailsData.ts:163`](../../libs/messages/src/JsonMessages/MapDetailsData.ts). Every other field is `.optional()`, and since the object is not `.strict()`, unknown keys are dropped. The "~45 fields" figure describes the surface of the type, not the obligation.

> That inverts where P0's risk sits. Satisfying `zod` is cheap; **functional** correctness is not. `mapUrl`/`wamUrl` and the `/~/` routing are what make a map actually load — and [`LocalAdmin.fetchMapDetails`](../../play/src/pusher/services/LocalAdmin.ts) is the executable specification for all of it. **P0 is a faithful port of `LocalAdmin` onto Postgres**, not a payload written from scratch.

#### Three fields `LocalAdmin` emits that the schema does not have (verified 2026-07-30)

`isMapDetailsData` has no key for any of these, and the object is not `.strict()`, so `zod` silently drops them. Reproducing them would be dead weight; the port deliberately omits all three:

| Field | Why it is not reproduced |
|---|---|
| `canEdit` | The map editor is unlocked by `/api/room/access`, whose value reaches the front through the protobuf `RoomJoinedMessage` ([`RoomConnection.ts:565`](../../play/src/front/Connection/RoomConnection.ts)). On `/api/map` it is read by nobody. |
| `loadingCowebsiteLogo` | No such key in the schema. |
| `opidUsernamePolicy` | An upstream typo for `opidWokaNamePolicy`. We emit the **correct** name. |

Emitting the correctly-spelled `opidWokaNamePolicy` is safe rather than a behaviour change, because the front already falls back to its own environment variable when the field is absent — [`Room.ts:183`](../../play/src/front/Connection/Room.ts): `data.opidWokaNamePolicy ?? OPID_WOKA_NAME_POLICY` — and both sides read the same value.

Note also that `editable` is in the schema but **nothing in `play` reads it**; `LocalAdmin` does not set it either. It is a SaaS-only field.

## Decision

### 1. New `admin-api` service, Clean Architecture, dedicated PostgreSQL

Domain → Application → Infrastructure/API. Its own Postgres (spec decision #3), no corporate-database integration in this phase.

**Stack: TypeScript, as a workspace inside this monorepo** (decided 2026-07-30), following the `map-storage` pattern — Express 5 + `tsx` + Vitest.

The deciding argument is mandatory test #1 below: *reuse the `zod` schemas from `@workadventure/messages`, do not retype them*. That is only literally possible in TypeScript. A .NET service — the house default in our general engineering standard — would force us to hand-retype `MapDetailsData` and `FetchMemberDataByUuidResponse` in C#, and upstream contract drift would then become invisible until it breaks login at runtime. Importing the schemas instead makes drift a **compile/test-time** failure on every `npm ci`.

Secondary gains: one `docker compose up`, one toolchain, one CI pipeline, and `libs/*` available for reuse.

What we give up: divergence from the .NET reference stack, and no EF Core. **Bet:** the contract-drift protection is worth more than stack uniformity for this specific service, because this service's entire job *is* the contract.

**ORM: Drizzle.** Schema declared in TypeScript (matches the repo's `strict` settings), forward-only migrations via `drizzle-kit`, SQL-first with no query-engine binary. Prisma would add a codegen step and ~50 MB to the image for three tables. The idempotent seed from decision #6 stays plain SQL with `ON CONFLICT DO NOTHING`.

### 2. Phasing driven by capabilities

`/api/capabilities` allows **incremental delivery without breaking `play`**: implement the blocking core first and declare only what exists.

### 3. Separate dashboard

Its own front (Next.js), authenticated for admins only, consuming `admin-api`'s own API — **not** the endpoints the pusher uses.

> ⚠️ **Partly superseded by [ADR-0004](0004-admin-dashboard.md) (2026-07-31).** The "separate Next.js front" half is
> replaced by a Svelte UI embedded in `admin-api`, following the `map-storage/src-ui` precedent this ADR did not
> account for. The "consumes our own API, not the pusher's endpoints" half stands, and ADR-0004 keeps it.

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
| **P0 — Skeleton that answers correctly** | `admin-api` + Postgres + **4** endpoints: `/api/capabilities` (always `200`), `/api/map`, `/api/room/access`, `/api/woka/list` (Trap #3). Goal: `ADMIN_API_URL` on and `play` working exactly as today. |
| **P1 — Members and tags** | Member CRUD, tag assignment, `canEdit` derived from tags. Endpoints `/api/members*`, `/api/world/tags`, `/api/room/tags`. |
| **P2 — Dashboard** | Admin UI: list/search members, assign tags, view rooms. |
| **P3 — Moderation** | `/api/ban`, `/api/report`, worlds, `/api/room/same`. |
| **P4 — Hardening** | Audit log, RBAC on the dashboard itself, STRIDE threat model, secret rotation. |

### Mandatory tests

1. **Contract test** per endpoint: the response validates against the very same `zod` schema the pusher uses (`isCapabilities`, `isMapDetailsData`, `isRoomRedirect`, `isFetchMemberDataByUuidResponse`, `wokaList`). *Reuse the schemas from `@workadventure/messages` — do not retype them.*

   > ⚠️ This was **not possible as written** (found 2026-07-30). Only `isMapDetailsData` lived in `@workadventure/messages`; the `/api/room/access` schema lived in `play/src/pusher/services/AdminApi.ts`, a module that validates `play`'s whole environment on import and calls `process.exit(1)` when it fails. It has been moved to [`libs/messages/src/JsonMessages/FetchMemberDataByUuidResponse.ts`](../../libs/messages/src/JsonMessages/FetchMemberDataByUuidResponse.ts) and re-exported from `AdminApi.ts`, so **no import site in `play` changed** and both sides of the contract now share one definition. There was precedent: `libs/shared-utils/src/SharedAdminApi.ts` already shares Admin API code with `back`.
   >
   > P3 needed the same move twice more (2026-08-04, [ADR-0005](0005-moderation.md)): `AdminBannedData` — which was defined **twice**, in `AdminApi.ts` and in `SharedAdminApi.ts` — and `ShortMapDescription`. The second one merges `WAMMetadata` from `@workadventure/map-editor`, and that package already depends on `messages`, so `WAMMetadata` moved too and is re-exported from `types.ts`. Again no import site changed anywhere.
2. End-to-end login with `ADMIN_API_URL` on.
3. `canEdit` true/false according to the member's tags.
4. **`/api/capabilities` answers `200` even with no capability at all** (`{}` is a valid body). ⚠️ *This replaces the original test #4 — "a 404 does not take `play` down" — which asserted a behaviour that does not exist: a 404 hangs the pusher (Trap #2).*
5. Wrong token → 403 on every endpoint **except `/api/capabilities`**, which must answer 200 with no token, and must reject a token wrapped in `Bearer`.
6. An unknown member on `/api/room/access` gets in with `tags: []` and `canEdit: false` — **never an error**, otherwise no new visitor can ever enter.
7. Any unimplemented path answers JSON, never Express's default HTML: every caller parses our responses with `zod`.

## Corrections (2026-07-30)

The contract was re-read against the code before starting P0. Four claims in the 2026-07-29 draft were wrong:

| # | Draft said | Code says | Effect on P0 |
|---|---|---|---|
| 1 | `/api/capabilities`: "404 is acceptable" | 404 → infinite retry → the pusher never opens its port (Trap #2) | Promoted to **blocking**; test #4 inverted |
| 2 | `/api/woka/list` is blocking | Capability-gated at [`WokaService.ts:10`](../../play/src/pusher/services/WokaService.ts); without the capability the pusher uses its local catalogue | Downgraded to 🟡 — but stays in P0 for reason #3 |
| 3 | *(not mentioned)* | `/api/room/access` must resolve `characterTextureIds` → `WokaDetail[]`, so the Woka catalogue is ours regardless (Trap #3) | `/api/woka/list` enters P0 as the single source of that catalogue |
| 4 | `MapDetailsData` has "~45 fields" to get right | The `zod` schema requires exactly one: `group`, nullable | P0's risk is functional, not schema-shaped: it is a faithful port of `LocalAdmin` |

A fifth surfaced while implementing E2:

| # | Draft said | Code says | Effect on P0 |
|---|---|---|---|
| 5 | `Authorization: <token>` on every endpoint | `/api/capabilities` is called with **no request config**, so no header at all ([`AdminApi.ts:208`](../../play/src/pusher/services/AdminApi.ts)) | The token guard must exempt that path, or a 403 hangs the pusher just like a 404 |

Plus one omission: the side effect of turning `admin-api` on covers **40 environment variables**, not just `MAP_EDITOR_ALLOW_ALL_USERS` (see *Important side effect*).

## Points confirmed

**2026-07-29**

1. ✅ **Identity** — internal PK + `email` as the lookup key + `oidc_sub` staged for Azure (decision #5). Keying on `sub` alone is not viable: the pusher does not send it.
2. ✅ **Bootstrap** — idempotent seed with the first admin's email from an env var (decision #6).
3. ✅ **Worlds** — single world in P0; `world` returned as a fixed value (decision #7).

**2026-07-30**

4. ✅ **Stack** — TypeScript workspace inside the monorepo, Express 5 + Vitest, Drizzle for persistence (decision #1). Driven by mandatory test #1: the `zod` schemas must be imported, not retyped.
5. ✅ **Configuration** — `admin-api` reads the same repository-root `.env` that `play` interpolates from, so the 40 shared variables have a single value.

No pending point blocks the start of P0.

## References

- [`play/src/pusher/services/AdminApi.ts`](../../play/src/pusher/services/AdminApi.ts) — **the contract's source of truth** (calls, headers, `zod` parsing, the `initialise()` retry loop)
- [`play/src/pusher/services/AdminInterface.ts`](../../play/src/pusher/services/AdminInterface.ts) — TypeScript interface
- [`play/src/pusher/services/LocalAdmin.ts`](../../play/src/pusher/services/LocalAdmin.ts) — default behaviour with no Admin API; **the executable spec for P0**
- [`play/src/pusher/services/WokaService.ts`](../../play/src/pusher/services/WokaService.ts) — capability gating for the Woka list (Trap #3)
- [`play/src/pusher/services/LocalWokaService.ts`](../../play/src/pusher/services/LocalWokaService.ts) — texture resolution and the `woka.json` catalogue
- [`play/src/pusher/app.ts`](../../play/src/pusher/app.ts) and [`play/src/server.ts`](../../play/src/server.ts) — the startup sequence that Trap #2 blocks
- [`libs/messages/src/JsonMessages/MapDetailsData.ts`](../../libs/messages/src/JsonMessages/MapDetailsData.ts) — the schema to import in the contract tests
- [Official doc: implement your own Admin API](../others/self-hosting/adminAPI.md)
- Reference Swagger: `https://play.workadventu.re/swagger-ui/`
- [Spec 0001 — Roadmap](../specs/0001-feature-roadmap.md) (Feature 3)

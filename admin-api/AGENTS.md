# AGENTS.md - admin-api/

VirtualOffice Admin API: members, tags and permissions. Implements the contract the `play` pusher expects when
`ADMIN_API_URL` is set. Design and phasing: [ADR-0002](../docs/adr/0002-admin-api.md).

## The rule that governs this package

**We do not own this contract — the pusher does.** Every response is validated at runtime by `zod` schemas living in
`@workadventure/messages`. Import those schemas in tests; never retype a contract shape by hand. A field of the wrong
type on `/api/map` or `/api/room/access` breaks login and map loading in production.

[`play/src/pusher/services/LocalAdmin.ts`](../play/src/pusher/services/LocalAdmin.ts) is the executable specification:
P0 must answer exactly like it does, with `tags`/`canEdit` coming from Postgres instead of environment variables.

Two verified traps, both documented in the ADR:

- `/api/capabilities` must answer **200** (an empty object is valid). A 404 puts the pusher in an uncapped retry loop
  and it never opens its port.
- `/api/room/access` must resolve `characterTextureIds` into `WokaDetail[]`. Returning an empty array bounces the user
  to the Woka selection page — forever, if our catalogue disagrees with the one `play` serves.

A third one, from [ADR-0005](../docs/adr/0005-moderation.md): **`/api/ban`, `/api/report` and `/api/room/sameWorld`
are gated by no capability at all**, so the pusher calls them the moment `ADMIN_API_URL` is set. There is no
negotiation and no way to opt out — an unimplemented route here is a broken feature in `play`, not a disabled one.

Moderation ([ADR-0006](../docs/adr/0006-dashboard-issued-bans.md)): the dashboard **issues** bans. `/api/room/access`
answers `ErrorApiData` (HTTP **200**, never 4xx — the pusher's axios throws on non-2xx) for a banned identifier,
which is what makes a ban survive reconnection; a banned identifier is a separate branch from an unknown one, whose
invariant is untouched. The kick rides the pusher's `/ws/admin/rooms` (`ADMIN_SOCKETS_TOKEN`, websocket app on port
**3001**), is best-effort, and never fails the ban.

## Two route spaces, two credentials, no overlap

| Space | Consumer | Credential | Guard |
|---|---|---|---|
| `/api/*` | the pusher | `ADMIN_API_TOKEN`, raw in `Authorization` | `adminApiTokenAuthentication` |
| `/admin/*` | the dashboard | signed session cookie | `adminSessionAuthentication` |

Neither credential is accepted in the other's space, and that has a test in both directions (ADR-0004, decision #3).
Each guard has an explicit allowlist — `/capabilities` on one side, `/login`, `/callback` and `/logout` on the other —
because everything else must be protected by default.

Three rules the dashboard cannot bend:

- **Authorisation is re-read from the database on every request.** The session cookie says *who*, never *what they may
  do*. That is what makes a revoked administrator lose access on their next click rather than an hour later.
- **The dashboard is optional.** Missing configuration disables `/admin/*` with a 503 and leaves `/api/*` alone. It
  must never stop the process: a dead `admin-api` hangs `play`.
- **Mutations are POST/PATCH/DELETE and carry `X-CSRF-Token`.** The session cookie is `SameSite=Lax`, not `Strict`,
  because `Strict` is withheld on the cross-site redirect back from the identity provider.

## Areas

- `src/Application/`: business logic, kept free of Express so it can be tested as plain functions. `AdminSession.ts`
  and `AdminLoginTransaction.ts` are pure token handling — the session rules are unit-testable without HTTP.
  `MemberAdministrationService.ts` owns what granting and revoking *mean*, and is called by both the CLI and
  `/admin/api/*`: two surfaces that hand out permissions must not be able to disagree. It also writes the audit
  entry, for the same reason — a surface that could forget to log is a gap in the only record there is.
- `src/api/`: Express controllers, middlewares and the server factory. `auditLog` and `roomCatalogue` are **top-level**
  server dependencies rather than dashboard ones: `POST /api/ban` writes to the log and `GET /api/room/sameWorld`
  reads the catalogue, both with `/admin/*` switched off.
- `src/Infrastructure/Oidc/`: the `openid-client` adapter behind `Application/Ports/OidcAuthenticator.ts`, so the
  barrier's tests never need a live identity provider.
- `src/Enum/`: environment variables, validated with `zod` at startup.
- `src-ui/`: the dashboard, Svelte 5 + Vite, built to the gitignored `dist-ui` and served under `/admin/`. Typechecked
  by `npm run ui:check` against `tsconfig-ui.json` — the node `tsconfig.json` excludes it. Strings are en-US + pt-BR
  in `src-ui/lib/i18n.ts`, with the type derived from English so a missing translation fails the build.

`start:dev` runs the API and `vite build --watch` side by side, deliberately **without** `--kill-others-on-fail`: a
broken UI build must not stop the API, whose death hangs `play`. Production builds the UI in the `Dockerfile`, where
a failure is caught before anything ships.
- `src/data/woka.json`: **a copy of** `play/src/pusher/data/woka.json`. `admin-api` is its own image in production
  and cannot read `play`'s files, so this copy has to be refreshed whenever upstream changes theirs.

## Configuration is shared with `play`

Every variable in `EnvironmentVariableValidator.ts` is also read by `play`. Once `ADMIN_API_URL` is set, `/api/map` is
built from **our** values and `play`'s copies stop applying to those fields — 40 variables in total. Compose
interpolates both services from the repository-root `.env` so they cannot drift. Defaults here must match
`play/src/pusher/enums/EnvironmentVariableValidator.ts` exactly.

## Persistence

Its own Postgres (`admin-api-db` in compose), never shared: this service owns identity and authorisation. Schema in
`src/Infrastructure/Database/schema.ts`, migrations generated by `drizzle-kit` into `drizzle/` and **forward-only** —
correct a mistake with a new migration, never by editing an applied one.

Foreign keys point at `member.id`, never at `email`. That is what makes an email change a one-column update instead of
a migration (ADR-0002, decision #5). Emails are stored and looked up lower-cased.

`audit_log`, `ban` and `report` are the exceptions, and deliberately so: they have **no foreign keys** and store
identities as snapshots. An entry has to keep naming who someone was at the time, after they are renamed or deleted —
a reference would either cascade the history away or quietly rewrite it. For `ban` and `report` there is a second
reason: the pusher names people with an anonymous uuid when they never logged in, so a foreign key would force a
visitor to become an account nobody can log into, and a cascade would mean deleting a member lifts their ban
(ADR-0005, decision #1). Nothing updates or deletes a row in any of the three.

`ban` has **no column for an IP address**, and an integration test asserts that against the real schema rather than
against our own writer (ADR-0005, decision #3).

The server migrates and runs the idempotent bootstrap before binding its port: answering the pusher against an
unmigrated schema would feed its retry loop and hang `play`.

## Common commands

```bash
cd admin-api

npm run typecheck
npm run lint
npm run pretty-check
npm test
```

Integration tests need a live Postgres and are excluded from `npm test` on purpose, so the unit suite stays runnable
with no infrastructure. They create their own `*_test` database rather than touching development data:

```bash
docker compose run --rm admin-api npm run test:integration
```

After changing `schema.ts`, regenerate and commit the migration:

```bash
docker compose run --rm admin-api npm run db:generate
```

Run a focused test once:

```bash
cd admin-api
npm test -- --run tests/health.test.ts
```

## Related guides

- `../docs/agent/testing-vitest.md`
- `../docs/agent/typescript-style.md`
- `../docs/agent/error-handling.md`

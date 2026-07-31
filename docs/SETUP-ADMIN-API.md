# Setup — `admin-api`

**TL;DR.** `admin-api` is the VirtualOffice service that decides who enters the world, with which tags, and who may
edit the map. Once `ADMIN_API_URL` is set, `play` stops using its built-in `LocalAdmin` stub and asks us instead.
`docker compose up -d` brings it up already wired; this document covers verifying it, granting permissions, and
rolling back.

**Audience.** Anyone running VirtualOffice locally, and whoever operates it later.

**Languages.** This file (en-US) + [SETUP-ADMIN-API.pt-BR.md](SETUP-ADMIN-API.pt-BR.md) (pt-BR), in lockstep.

**Design.** [ADR-0002](adr/0002-admin-api.md).

---

## Prerequisites

- Docker and Docker Compose.
- A `.env` at the repository root: `cp .env.template .env`. The defaults already point `play` at `admin-api`.
- **On Windows**, one line in `C:\Windows\System32\drivers\etc\hosts` (needs administrator rights), alongside the
  entries the other services already have:

  ```
  127.0.0.1 admin-api.workadventure.localhost
  ```

  Browsers and `curl` resolve `*.localhost` on their own, so the app works without it. Node does not, so the
  end-to-end suite and any script using `fetch` fail with `ENOTFOUND` until the line is there. Linux resolvers
  handle `*.localhost` natively, which is why CI needs nothing.

## What gets provisioned

| Service | Role |
|---|---|
| `admin-api` | HTTP API the pusher calls. Port 3000 inside the network, `http://admin-api.workadventure.localhost` from your browser. |
| `admin-api-db` | Its own PostgreSQL 17. Not shared with any other service: this one owns identity and authorisation. |

Data lives in the named volume `admin-api-db-data`, so `docker compose down` keeps your members and tags. Only
`docker compose down -v` discards them.

## Starting

```bash
docker compose up -d play
```

`play` waits for `admin-api` to report healthy before it starts, and `admin-api` waits for Postgres. That ordering is
not cosmetic — see *Troubleshooting* below.

On its first start `admin-api` applies its migrations and runs an **idempotent bootstrap**: it creates the `admin` and
`editor` tags, and grants `admin` to `ADMIN_API_BOOTSTRAP_ADMIN_EMAIL`. Running it again changes nothing, which is why
it can run on every boot rather than being a script somebody has to remember.

## Verification

Liveness, and readiness (which actually queries Postgres):

```bash
curl -s http://admin-api.workadventure.localhost/readyz
```

Capability negotiation. This endpoint is deliberately public — the pusher calls it with no `Authorization` header:

```bash
curl -s http://admin-api.workadventure.localhost/api/capabilities
```

Everything else requires the token, so this must answer `403`:

```bash
curl -i -s http://admin-api.workadventure.localhost/api/room/access | head -1
```

Confirm the pusher connected. You are looking for `Remote admin api connection successful`:

```bash
docker compose logs play | grep -a "admin api"
```

Then open `http://play.workadventure.localhost`, log in as `User1` / `pwd`, and check that **Map editor** appears in
the map menu.

> There is no page at `/`. `admin-api` serves `/api/*`, `/healthz` and `/readyz` only, so a `404` with
> `ADMIN_API_NOT_FOUND` there is correct. And `http://admin-api:3000` is a Docker-network name — reachable from other
> containers, never from your browser.

## Managing permissions

Until the dashboard arrives (ADR-0002, P2), permissions are managed with a CLI that runs inside the container. It
uses the service's own database credentials and adds no network surface — that is the whole reason it is a CLI and
not an HTTP endpoint (ADR-0003, decision #3).

Two tags exist out of the box: `admin` and `editor`. Either one unlocks the map editor, and only in `/~/` rooms —
external `/_/` maps are never editable.

See who holds what:

```bash
docker compose exec admin-api npm run member:list
```

Grant a tag. Idempotent — running it twice is not an error:

```bash
docker compose exec admin-api npm run member:grant -- someone@example.com editor
```

Revoke it:

```bash
docker compose exec admin-api npm run member:revoke -- someone@example.com editor
```

Set the name the map editor's member picker shows instead of a bare email:

```bash
docker compose exec admin-api npm run member:set-name -- someone@example.com "Someone Else"
```

List the tag catalogue:

```bash
docker compose exec admin-api npm run tag:list
```

A change takes effect on the person's **next login**: `canEdit` is resolved when they enter the room, not
continuously.

Three behaviours worth knowing:

- **Emails are stored and matched lower-cased**, so `Someone@Example.com` and `someone@example.com` are the same
  person.
- **`member:grant` creates the tag if it does not exist**, because the map editor's pickers accept free text and an
  arbitrary tag is a meaningful thing to gate an area on. It prints a notice listing the tags that already existed,
  so a typo like `editr` is caught at the prompt rather than at someone's next login.
- **`member:set-name` refuses an unknown member** rather than creating one — a typo there would produce an account
  nobody ever logs into. Grant them a tag first, or let them log in once.

There is no `member:delete`. Removing a member is destructive and rare enough to be worth doing deliberately in SQL:

```bash
docker compose exec -T admin-api-db psql -U admin_api -d admin_api -c "DELETE FROM member WHERE email=lower('someone@example.com');"
```

### Which email?

The one the identity provider puts in the token — that is what the pusher sends us. With the development OIDC mock:

| Login | Password | Email |
|---|---|---|
| `User1` | `pwd` | `john.doe@example.com` |
| `User2` | `pwd` | `alice.doe@example.com` |

`ADMIN_API_BOOTSTRAP_ADMIN_EMAIL` defaults to `john.doe@example.com` for exactly this reason: a fresh clone has a
working administrator without anyone editing a file.

## Administration dashboard (ADR-0004)

Open `http://admin-api.workadventure.localhost/admin/`, sign in through the identity provider, and manage members
from the screen. Everything below documents how it is wired.

| Route | Method | Who |
|---|---|---|
| `/admin/login` | GET | anyone (rate-limited) |
| `/admin/callback` | GET | the identity provider |
| `/admin/logout` | POST | anyone; needs the CSRF token when a session exists |
| `/admin/me` | GET | an administrator |
| everything else under `/admin` | — | an administrator |

### Configuration

Four variables, all with working development defaults in `docker-compose.yaml`:

| Variable | Default | Notes |
|---|---|---|
| `ADMIN_API_PUBLIC_URL` | `http://admin-api.workadventure.localhost` | The address a **browser** uses. Empty disables the dashboard. |
| `ADMIN_API_SESSION_SECRET` | a development-only value | At least 32 characters. **Change it outside local development.** |
| `ADMIN_API_TRUST_PROXY` | `1` | Set to `false` if `admin-api` is ever exposed without a proxy in front. |
| `OPENID_CLIENT_ID` / `_SECRET` / `_ISSUER` | the mock's client | The same provider `play` uses. |

The session secret is deliberately **not** `ADMIN_API_TOKEN`. That one is shared with the pusher, and a secret that
both serves machines and mints human sessions turns a single leak into full impersonation.

If any of it is missing, `/admin/*` answers `503 ADMIN_DASHBOARD_DISABLED` and the startup log names what is absent.
The service still boots and `/api/*` is untouched — a dashboard misconfiguration must never become a `play` outage.

### The screen (G2)

Svelte 5 + Vite in [`admin-api/src-ui/`](../admin-api/src-ui), built to `dist-ui` and served by the same service
under `/admin/` — one deploy unit, one origin, no CORS. It follows [`map-storage/src-ui`](../map-storage/src-ui),
the precedent ADR-0004 names.

```bash
# Build it once
docker compose exec admin-api npm run ui:build

# Typecheck the Svelte half (the node half is `npm run typecheck`)
docker compose exec admin-api npm run ui:check
```

In development `npm run start:dev` already runs `vite build --watch` alongside the API, so a saved file is rebuilt
and a browser refresh shows it. There is **no `--kill-others-on-fail`**: a broken UI build must never take the API
down with it. Production images build the UI in the `Dockerfile`, so a broken front end fails the image build rather
than the container start.

`dist-ui` is generated and gitignored. When it is absent the service runs exactly as it did before the screen
existed — `/admin/` answers a JSON 404, and everything else is unchanged.

The interface is in **en-US and pt-BR**, chosen from the browser's language. Strings live in
[`src-ui/lib/i18n.ts`](../admin-api/src-ui/lib/i18n.ts); the type derives from the English catalogue, so a key added
in one language fails the build until the other has it.

### Verification

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://admin-api.workadventure.localhost/admin/me
```

Expect `302` to `/admin/login?returnTo=%2Fadmin%2Fme`. Then open
`http://admin-api.workadventure.localhost/admin/` in a browser and sign in as `User1` / `pwd`. You should land on the
member list, with your own row showing the `admin` tag.

Two properties worth checking by hand, because they are the whole point of this slice:

```bash
# The pusher's token does not open the dashboard: still a redirect to the login.
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: $ADMIN_API_TOKEN" \
  http://admin-api.workadventure.localhost/admin/me

# A revoked administrator is refused on the very next request, with the same cookie.
docker compose exec admin-api npm run member:revoke -- john.doe@example.com admin
# reload /admin/me in the browser -> 403 ADMIN_FORBIDDEN
docker compose exec admin-api npm run member:grant  -- john.doe@example.com admin
# reload again -> 200
```

### Management endpoints (G1)

Behind the barrier, so every call needs the session cookie, and every mutation also needs the CSRF token from the
`admin_csrf` cookie in an `X-CSRF-Token` header.

| Endpoint | Method | Answers |
|---|---|---|
| `/admin/api/members` | GET | every member with their tags; `?search=` filters, tags included |
| `/admin/api/members/{email}` | GET | one member |
| `/admin/api/members/{email}` | PATCH | `{ "username": "…" \| null }` — sets or clears the display name |
| `/admin/api/members/{email}/tags` | POST | `{ "tag": "…" }` — grants; answers `{ member, createdTag }` |
| `/admin/api/members/{email}/tags/{tag}` | DELETE | revokes; answers `{ member, wasHeld }` |
| `/admin/api/tags` | GET | the tag catalogue |

Three behaviours are deliberate and shared with the CLI, because both call the same Application service:

- **Granting creates what is missing.** A member who has never logged in is created, and so is a tag nobody has used
  yet. Preparing access ahead of someone's first login is the point.
- **`createdTag: true` is a warning, not a success detail.** Tags are free text and case-sensitive, so `Admin` is a
  brand new label that grants nothing at all. That flag is how the mistake surfaces at the click.
- **Revoking a tag the member never held succeeds**, with `wasHeld: false`. An unknown *member* or an unknown *tag*
  is a 404, and the two are reported separately.

From the browser's console on `/admin/`, which is also how the G2 screens will call it:

```js
const csrf = document.cookie.split('; ').find(c => c.startsWith('admin_csrf='))?.split('=')[1];
await fetch('/admin/api/members/someone@example.com/tags', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
  body: JSON.stringify({ tag: 'editor' }),
}).then(r => r.json());
```

### Locked out?

Removing your own `admin` tag is allowed, including when you are the last administrator. The bootstrap runs on
**every** startup, so restarting restores `ADMIN_API_BOOTSTRAP_ADMIN_EMAIL`:

```bash
docker compose restart admin-api
```

## Rolling back

Empty `ADMIN_API_URL` in your `.env` and recreate `play`. The pusher returns to `LocalAdmin` immediately:

```bash
docker compose up -d --force-recreate play
```

Nothing is lost — members and tags stay in Postgres, unused, until you switch back.

## What changes when it is switched on

This is the part that surprises people.

- **OIDC tags stop counting.** The pusher does not forward the claim to us at all. Anyone who had `admin` or `editor`
  purely through OIDC, and has no member row, loses map-editor access until granted the tag.
- **`MAP_EDITOR_ALLOW_ALL_USERS` and `MAP_EDITOR_ALLOWED_USERS` leave the stage.** Authorisation is the database's job
  now, deliberately: a permission has to be grantable through a screen, not an environment variable.
- **~28 more environment variables move.** `/api/map` is built from **our** environment, so `ENABLE_CHAT*`,
  `START_ROOM_URL`, `DISABLE_ANONYMOUS`, `SKIP_CAMERA_PAGE` and friends are read by `admin-api` and `play`'s copies
  stop applying to those fields. Compose interpolates both services from the same root `.env` so they cannot drift.

## Troubleshooting

**`invalid_request / Invalid redirect_uri` on the provider's error page when logging into the dashboard.** It reads
like our misconfiguration and is not. The development mock's wildcard, `http://*.workadventure.localhost`, does **not
match a hyphen in the hostname** — `adminapi` is accepted, `admin-api` and `map-storage` are not, whatever the path.
That is why `http://admin-api.workadventure.localhost/admin/callback` is registered explicitly in
[`contrib/oidc-server-mock/clients-config.json`](../contrib/oidc-server-mock/clients-config.json). If you change
`ADMIN_API_PUBLIC_URL`, add the new callback there and recreate the mock:

```bash
docker compose up -d --force-recreate oidc-server-mock
```

**`503 ADMIN_DASHBOARD_DISABLED` on every `/admin` route.** Configuration is missing or incomplete. The startup log
names it:

```bash
docker compose logs admin-api | grep "dashboard is disabled"
```

**502 Bad Gateway right after starting.** Almost always still booting: `play` takes minutes (Vite alone can spend
150 s), and Traefik has no upstream until the pusher listens. Watch `docker compose logs -f play` for
`WorkAdventure Pusher web-server started`.

**502 that never clears.** Check whether the pusher ever finished starting:

```bash
docker compose logs play | grep -a "web-server started"
```

If that line is missing while `Admin api is enabled at ...` is present, the pusher is stuck negotiating capabilities.
`AdminApi.initialise()` retries **without a cap** and `play` awaits it *before* opening its port, so any persistent
error there — a 404, a 403, a connection refused — hangs `play` silently. Verify `admin-api` answers:

```bash
docker compose exec play node -e "fetch('http://admin-api:3000/api/capabilities').then(async r=>console.log(r.status, await r.text()))"
```

**Logged in, but no map editor.** The email in your token has no `admin`/`editor` row. List the members (above) and
compare with the email your identity provider issues. Remember the change only applies after a fresh login.

**Avatars render blank.** Means `characterTextures` came back empty. Check what the endpoint returns for the ids the
front sends:

```bash
docker compose exec play node -e "const a=require('/usr/src/app/node_modules/axios'); a.get('http://admin-api:3000/api/room/access',{params:{userIdentifier:'john.doe@example.com',playUri:'http://play.workadventure.localhost/~/maps/areas.wam',characterTextureIds:['male1','body1']},headers:{Authorization:process.env.ADMIN_API_TOKEN}}).then(r=>console.log(JSON.stringify(r.data.characterTextures)))"
```

**Migrations failed at boot.** `admin-api` refuses to serve rather than answering against an unmigrated schema, since
errors here feed the pusher's retry loop. Read the reason:

```bash
docker compose logs admin-api | grep -iA5 "failed to start"
```

## Running the tests

Unit and contract tests need no infrastructure:

```bash
docker compose run --rm admin-api npm test -- --run
```

Integration tests need Postgres. They create their own `*_test` database rather than touching your data:

```bash
docker compose run --rm admin-api npm run test:integration -- --run
```

End-to-end. Playwright runs from the host, against the running stack — see [`tests/AGENTS.md`](../tests/AGENTS.md)
for the one-time `npx playwright install --with-deps`:

```bash
cd tests && npm run test -- tests/admin_api.spec.ts --project=chromium
```

## References

- [ADR-0002 — Our own Admin API](adr/0002-admin-api.md)
- [`admin-api/AGENTS.md`](../admin-api/AGENTS.md) — conventions for working inside the service
- [`play/src/pusher/services/LocalAdmin.ts`](../play/src/pusher/services/LocalAdmin.ts) — the behaviour `admin-api` replaces

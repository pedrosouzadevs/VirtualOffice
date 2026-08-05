# Setup — `admin-api`

**TL;DR.** `admin-api` is the ArqueumSpace service that decides who enters the world, with which tags, and who may
edit the map. Once `ADMIN_API_URL` is set, `play` stops using its built-in `LocalAdmin` stub and asks us instead.
`docker compose up -d` brings it up already wired; this document covers verifying it, granting permissions, and
rolling back.

**Audience.** Anyone running ArqueumSpace locally, and whoever operates it later.

**Languages.** This file (en-US) + [SETUP-ADMIN-API.pt-BR.md](SETUP-ADMIN-API.pt-BR.md) (pt-BR), in lockstep.

**Design.** [ADR-0002](adr/0002-admin-api.md).

---

## Prerequisites

- Docker and Docker Compose.
- A `.env` at the repository root: `cp .env.template .env`. The defaults already point `play` at `admin-api`.
- **On Windows**, one line in `C:\Windows\System32\drivers\etc\hosts` (needs administrator rights), alongside the
  entries the other services already have:

  ```
  127.0.0.1 admin-api.arqueum.localhost
  ```

  Browsers and `curl` resolve `*.localhost` on their own, so the app works without it. Node does not, so the
  end-to-end suite and any script using `fetch` fail with `ENOTFOUND` until the line is there. Linux resolvers
  handle `*.localhost` natively, which is why CI needs nothing.

## What gets provisioned

| Service | Role |
|---|---|
| `admin-api` | HTTP API the pusher calls. Port 3000 inside the network, `http://admin-api.arqueum.localhost` from your browser. |
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
curl -s http://admin-api.arqueum.localhost/readyz
```

Capability negotiation. This endpoint is deliberately public — the pusher calls it with no `Authorization` header:

```bash
curl -s http://admin-api.arqueum.localhost/api/capabilities
```

Everything else requires the token, so this must answer `403`:

```bash
curl -i -s http://admin-api.arqueum.localhost/api/room/access | head -1
```

Confirm the pusher connected. You are looking for `Remote admin api connection successful`:

```bash
docker compose logs play | grep -a "admin api"
```

Then open `http://play.arqueum.localhost`, log in as `User1` / `pwd`, and check that **Map editor** appears in
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

Open `http://admin-api.arqueum.localhost/admin/`, sign in through the identity provider, and manage members
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
| `ADMIN_API_PUBLIC_URL` | `http://admin-api.arqueum.localhost` | The address a **browser** uses. Empty disables the dashboard. |
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
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://admin-api.arqueum.localhost/admin/me
```

Expect `302` to `/admin/login?returnTo=%2Fadmin%2Fme`. Then open
`http://admin-api.arqueum.localhost/admin/` in a browser and sign in as `User1` / `pwd`. You should land on the
member list, with your own row showing the `admin` tag.

Two properties worth checking by hand, because they are the whole point of this slice:

```bash
# The pusher's token does not open the dashboard: still a redirect to the login.
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: $ADMIN_API_TOKEN" \
  http://admin-api.arqueum.localhost/admin/me

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
| `/admin/api/rooms` | GET | the world's maps, read from `map-storage` |
| `/admin/api/rooms/{path}/areas` | GET | the areas inside one map, with personal-area owners resolved |
| `/admin/api/audit` | GET | the audit log; `?target=<email>&limit=<n>` |

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

### Rooms and their areas (G3)

The **Rooms** tab lists the world's maps, and each one opens onto what is drawn inside it: personal desks, silent
zones, meeting spots. That is the point of the screen — a personal area's owner lives in the `.wam` file and is
invisible anywhere outside the map editor, yet "who owns that desk" is what an administrator arrives asking.

A personal area shows the owner's **email**, because that is literally what the map stores in
`personalAreaPropertyData.ownerId` — the same value `/api/room/access` returns as `userUuid` (ADR-0002, invariant
#2). Three states are told apart on purpose:

| Shown | Means |
|---|---|
| an email, with a name under it | claimed, and we have a member row for the owner |
| an email, marked *unknown* | claimed by an address with no member row — usually claimed before the Admin API was switched on |
| *Unclaimed* | nobody has taken the area yet |

`INTERNAL_MAP_STORAGE_URL` is all the configuration this needs: `GET /maps` and the `.wam` files on `map-storage` are
**unauthenticated**, the same call `play` makes from `LocalAdmin`. Worth knowing rather than assuming — the room list
is readable by anything on the Docker network, which is map-storage's decision and not one this service can tighten.
What the dashboard adds is that *its* copy sits behind the session barrier.

Read-only. Editing a map is the map editor's job, and a write here would be a second place that can change a map,
with different rules and a different audit story.

### The audit log (G4)

Every permission change is recorded, append-only: actor, action, target, timestamp, and enough detail to read the
entry on its own. Nothing updates or deletes a row — there is no code path that can.

```bash
# Everything, newest first
docker compose exec admin-api npm run audit:list

# Everything that ever happened to one person
docker compose exec admin-api npm run audit:list -- alguem@empresa.com
```

Also over HTTP, behind the session: `GET /admin/api/audit`, optionally `?target=<email>&limit=<n>`.

Two things worth knowing before you read it:

- **Changes made with the CLI are attributed to `cli`, not to a person.** A command run inside the container has no
  logged-in identity, so the entry says "somebody with shell access did this" rather than inventing a name. It is
  recorded rather than skipped because the log's value is that it has no gaps.
- **Actor and target are email snapshots, not references.** An entry keeps naming who someone was at the time, even
  after they are renamed or deleted. That is deliberate: a log that changes with the world it describes is not
  evidence of anything.

This is an **administrative** audit — who changed permissions. It is not a usage log: logins, room entries and calls
happen in `play`, `back` and the media server, and none of them pass through here.

### Granting `admin`

**Only direct SQL can.** Neither the dashboard nor the CLI will — both refuse, record the attempt, and raise an
alert. That is threat model finding
[F1](security/threat-model.md#f1--a-stolen-admin-session-can-create-a-permanent-administrator): a stolen browser
session lasts minutes, an `admin` grant lasts forever, and the two should not be one click apart.

```bash
# The member and the tag must both exist. Grant them any other tag first if they are new —
# that is what creates the member.
docker compose exec admin-api-db psql -U admin_api -d admin_api -c \
  "insert into member_tag (member_id, tag_id)
   select m.id, t.id from member m, tag t
   where m.email = 'alguem@empresa.com' and t.name = 'admin'
   on conflict do nothing;"
```

The CLI prints this exact command when you try, so you do not have to come back here.

**Revoking `admin` is not restricted** — the dashboard and `member:revoke` both do it, and both raise an alert.
Needing a DBA to remove an administrator during an incident would be the wrong trade.

**A grant made this way leaves no audit entry.** SQL bypasses the log. That is the deliberate cost of putting the
privilege out of reach of an application surface; write down who you granted it to and why.

### Alerts

Two events are shouted about rather than merely recorded:

| Event | When |
|---|---|
| `admin.grant.refused` | somebody tried to grant `admin` through the dashboard or the CLI |
| `admin.revoked` | somebody removed an `admin` tag that was actually held |

Both always go to the log at `error` level with a fixed `[ADMIN-ALERT]` marker, which is what log-based alerting can
match on with no configuration. Set `ADMIN_API_ALERT_WEBHOOK_URL` to also POST them as JSON — a Slack or Teams
incoming webhook reads the `text` field; anything else gets the structured fields too.

```bash
docker compose logs admin-api | grep ADMIN-ALERT
```

### Locked out?

Removing your own `admin` tag is allowed, including when you are the last administrator. The bootstrap runs on
**every** startup, so restarting restores `ADMIN_API_BOOTSTRAP_ADMIN_EMAIL`:

```bash
docker compose restart admin-api
```

## Moderation (ADR-0005, revised by ADR-0006)

**Bans are issued from the dashboard** — the Moderation tab has the form. A dashboard ban does three things, in this
order:

1. **Records** who banned whom, with what message — the append-only `ban` table plus an audit entry naming the
   logged-in administrator.
2. **Closes the door:** `/api/room/access`, the endpoint the pusher calls on every connection and login, answers the
   error variant for a banned identifier. That is what makes a ban survive reconnection
   ([ADR-0006, decision #2](adr/0006-dashboard-issued-bans.md)) — no `verifyBanUser` caller needed.
3. **Kicks, best-effort:** `admin-api` asks the pusher to remove the person from the running world over the
   `/ws/admin/rooms` channel. When that fails the screen says so — the person is out at the latest when their
   session ends, and can never reconnect either way.

Reporting still happens inside the world (any user, from the action menu), and reports stay read-only everywhere.

> `play` itself still ships no ban button — `ActionMediaBox.svelte` carries a commented-out `ban()` marked
> `TODO: implement ban user` — and that is now a decision rather than a gap: one issuing surface, the dashboard
> (ADR-0006, decision #1). The scripting API's `banUser` event remains available to map scripts.

### The kick channel

Three values, all defaulted for development in `docker-compose.yaml`:

| Variable | What it does |
|---|---|
| `ADMIN_SOCKETS_TOKEN` | Shared secret: mounts the pusher's `/ws/admin/rooms` endpoint **and** signs `admin-api`'s kick. Generate a real one for any deployment: `openssl rand -base64 48`. |
| `PLAY_URL` | The world's public origin — what a pusher room id starts with. |
| `INTERNAL_PLAY_URL` | The pusher's in-network address (`http://play:3001`), where the websocket connects. |

Any of them missing degrades a dashboard ban to record-plus-door, reported as *"could not be removed right now"* —
never an error. **Whoever holds `ADMIN_SOCKETS_TOKEN` can kick anyone** (not ban: the record needs the dashboard),
so it is a real secret; the threat model lists it as an asset.

```bash
docker compose exec admin-api npm run ban:list
docker compose exec admin-api npm run report:list
```

Also on the dashboard, under **Moderation**, and over HTTP behind the session: `GET /admin/api/bans`,
`POST /admin/api/bans` and `GET /admin/api/reports`.

Three things worth knowing before you rely on any of it:

- **Nothing is notified.** A report lands in a table and waits to be read. No email, no webhook, no queue, until
  somebody owns triage — a channel nobody agreed to watch is worse than a list somebody checks.
- **No IP address is stored.** `GET /api/ban` receives one and drops it: it is personal data under the LGPD, it
  identifies a household rather than a person, and it is the one field here that would arrive with a retention
  obligation attached. There is no column to put one in.
- **Both records name people with snapshots, not references.** The identifier is an email for anyone who logged in
  and an anonymous uuid for a visitor who did not, and deleting the member does not erase the ban.

### Lifting a ban, or deleting a report

Direct SQL, like member deletion — there is no button and no command, because what lifting a ban *means* is still
undecided and a button would decide it by accident (ADR-0006 kept ADR-0005's reasoning here):

```bash
docker compose exec admin-api-db psql -U admin_api -d admin_api -c \
  "delete from ban where identifier = 'alguem@empresa.com';"
```

The door checks the **most recent** ban for the identifier, so the delete must remove every row naming them — the
statement above does. From the next connection attempt on, the person is let back in.

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
like our misconfiguration and is not. The development mock's wildcard, `http://*.arqueum.localhost`, does **not
match a hyphen in the hostname** — `adminapi` is accepted, `admin-api` and `map-storage` are not, whatever the path.
That is why `http://admin-api.arqueum.localhost/admin/callback` is registered explicitly in
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
`ArqueumSpace Pusher web-server started`.

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
docker compose exec play node -e "const a=require('/usr/src/app/node_modules/axios'); a.get('http://admin-api:3000/api/room/access',{params:{userIdentifier:'john.doe@example.com',playUri:'http://play.arqueum.localhost/~/maps/areas.wam',characterTextureIds:['male1','body1']},headers:{Authorization:process.env.ADMIN_API_TOKEN}}).then(r=>console.log(JSON.stringify(r.data.characterTextures)))"
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

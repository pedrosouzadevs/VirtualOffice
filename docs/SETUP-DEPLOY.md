# Setup — production deploy (Hostinger VPS)

> **Purpose.** Take VirtualOffice from this repository to a single VPS serving up to ~30 concurrent users, on one
> domain, with Azure Entra ID login and the Admin API in charge of permissions and moderation.
> **Audience.** Whoever operates the server. Written against a Hostinger KVM plan (4 vCPU, 16 GB RAM, 200 GB NVMe,
> 16 TB traffic) — any Ubuntu VPS with those numbers works the same.
> **Languages.** This file (en-US) + [SETUP-DEPLOY.pt-BR.md](SETUP-DEPLOY.pt-BR.md), in lockstep.

## What you end up with

One domain, one certificate, ports 80/443. Traefik fans out by path:

| Path | Service |
|---|---|
| `/` | the world (`play`) |
| `/ws/` | the pusher's websockets |
| `/admin` | the administration dashboard (`admin-api`) |
| `/api` | `back` |
| `/map-storage` | maps + inline map editor backend |
| `/uploader`, `/icon` | chat uploads, favicons |

`admin-api`'s own `/api/*` — the contract the pusher consumes — is **never** exposed; the pusher reaches it
in-network at `http://admin-api:3000`.

Everything runs from `contrib/docker/docker-compose.prod.yaml`, and the five Node services (`play`, `back`,
`map-storage`, `uploader`, `admin-api`) are **built from this repository**, not pulled from Docker Hub — the
upstream images do not contain this fork (F4's area-owner lock, the Admin API, its schemas).

## Prerequisites

- The VPS, with **Ubuntu 24.04 LTS** — pick it in Hostinger's OS panel (plain OS, no template).
- A **domain** you control, and access to its DNS.
- The **Entra ID tenant** with your users, and rights to create an app registration
  ([SETUP-CLOUD-AZURE.md](SETUP-CLOUD-AZURE.md)).
- This repository reachable from the VPS (a git remote you can clone from).

Sizing sanity check: upstream states 2 vCPU / 4 GB serves up to 300 concurrent users — video is peer-to-peer and
does not cross the server. Your plan is comfortable; the first image build is the only heavy moment.

## 1. DNS

One `A` record for your domain (say `office.example.com`) pointing at the VPS IP. Nothing else. Let DNS propagate
before starting — Let's Encrypt must resolve the name to this machine.

## 2. First access and hardening

```bash
ssh root@<VPS-IP>

# A user of your own; root stays for emergencies only.
adduser deploy && usermod -aG sudo deploy

# Firewall: SSH + web, nothing else. (Coturn adds its own ports later — section 8.)
apt-get update && apt-get install -y ufw
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp
ufw enable
```

Hostinger's panel also has an external firewall — mirror the same three rules there if you enable it.

## 3. Docker

```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
```

Log out and back in as `deploy` so the group applies.

## 4. Clone and configure

```bash
git clone <your-git-remote> virtualoffice
cd virtualoffice/contrib/docker
cp .env.prod.template .env
```

Generate every secret — five values, five different outputs, none reused:

```bash
for v in SECRET_KEY ADMIN_API_TOKEN ADMIN_SOCKETS_TOKEN ADMIN_API_SESSION_SECRET ADMIN_API_DB_PASSWORD; do echo "$v=$(openssl rand -base64 48 | tr -d '\n')"; done
```

Then edit `.env` and fill in, at minimum:

| Variable | Value |
|---|---|
| the five secrets above | pasted from the command |
| `DOMAIN` | `office.example.com` — no scheme |
| `ACME_EMAIL` | where certificate warnings go |
| `ADMIN_API_BOOTSTRAP_ADMIN_EMAIL` | **your Entra email** — it receives the `admin` tag on every boot, and is the lockout recovery |
| `MAP_STORAGE_AUTHENTICATION_PASSWORD` | `openssl rand -base64 24` — map upload credential |
| `ROOM_API_SECRET_KEY` | another generated value, or empty to disable the Room API |
| the `OPENID_*` block | next step |

## 5. Entra ID

From any machine with Azure CLI (your workstation is fine):

```bash
pwsh docs/index/setup-entra-id.ps1 -PlayUrl https://office.example.com -AdminApiUrl https://office.example.com
```

**Same domain in both parameters** — single-domain mode registers the three callbacks
(`/openid-callback`, `/logout-callback`, `/admin/callback`) on one host. The script prints the `OPENID_*` block
once; paste it into `.env`. Manual path and AADSTS troubleshooting: [SETUP-CLOUD-AZURE.md](SETUP-CLOUD-AZURE.md).

## 6. Build and start

```bash
docker compose build          # first time: 20-40 min — five images built from source
docker compose up -d
docker compose logs -f play   # until: "Remote admin api connection successful"
```

The startup order is enforced by healthchecks: Postgres → `admin-api` (migrations + admin bootstrap) → `play`.

## 7. First map and first login

1. `https://office.example.com/map-storage/` — Basic auth with the `MAP_STORAGE_AUTHENTICATION_USER/PASSWORD`
   values. Upload the office map (the repository's `maps/` work, or the
   [map starter kit](https://github.com/workadventure/map-starter-kit)).
2. Confirm `START_ROOM_URL` in `.env` matches the uploaded path (`/~/maps/office.wam`); `docker compose up -d`
   again if you changed it.
3. Open `https://office.example.com` in a private window → Microsoft sign-in → you are in the office.
4. `https://office.example.com/admin` → same sign-in → the dashboard, because the bootstrap granted you `admin`.
5. Grant your first tags from the Members tab (`editor` unlocks the map editor).

## 8. Coturn (video through corporate networks)

Video is peer-to-peer; TURN is the relay for people behind strict NATs. On the same VPS:

```bash
sudo apt-get install -y coturn
```

`/etc/turnserver.conf` — minimal, static-secret mode (generate yet another secret):

```
listening-port=3478
tls-listening-port=5349
realm=office.example.com
use-auth-secret
static-auth-secret=<openssl rand -base64 32>
cert=/path/to/fullchain.pem
pkey=/path/to/privkey.pem
no-multicast-peers
min-port=49152
max-port=49352
```

```bash
ufw allow 3478 && ufw allow 5349 && ufw allow 49152:49352/udp
sudo systemctl enable --now coturn
```

Then in `.env`: `TURN_SERVER=turn:office.example.com:3478`, `TURN_STATIC_AUTH_SECRET=<the secret>`, and
`docker compose up -d`. (TLS on 5349 can reuse the Traefik certificate from `${DATA_DIR}/letsencrypt/` — or run
plain 3478 first and harden later; the static secret is the part that must not wait.)

## 9. Verification

```bash
curl -s https://office.example.com/map-storage/ -o /dev/null -w "%{http_code}\n"   # 401 (auth wall = alive)
docker compose exec admin-api npm run member:list                                   # your email, tag admin
docker compose logs play | grep -a "admin api"                                      # connection successful
```

Then the human checklist: log in, walk, meet someone in a bubble (video), edit the map with an `editor` tag, ban a
test account from `/admin` → Moderation and watch it leave and fail to return. The session lifetimes you should
expect are: world 30 days, dashboard 1 h sliding / 12 h cap.

## Backups

Three things hold state; everything else rebuilds from the repo:

| What | Where | How |
|---|---|---|
| Members, tags, bans, reports, audit | `admin-api-db-data` volume | nightly `pg_dump` |
| Maps | `map-storage-data` volume | nightly tar |
| Certificates | `${DATA_DIR}/letsencrypt/` | copy with the tar |

```bash
sudo tee /etc/cron.daily/virtualoffice-backup >/dev/null <<'EOF'
#!/bin/sh
set -e
STAMP=$(date +%F)
DIR=/var/backups/virtualoffice
mkdir -p "$DIR"
cd /home/deploy/virtualoffice/contrib/docker
docker compose exec -T admin-api-db pg_dump -U admin_api admin_api | gzip > "$DIR/admin-api-$STAMP.sql.gz"
docker run --rm -v docker_map-storage-data:/maps -v "$DIR":/backup alpine tar czf "/backup/maps-$STAMP.tar.gz" -C /maps .
find "$DIR" -mtime +14 -delete
EOF
sudo chmod +x /etc/cron.daily/virtualoffice-backup
```

(Adjust the volume prefix to what `docker volume ls` shows.) Hostinger's weekly VPS snapshots are the second layer,
not a replacement — test a restore once before trusting either.

## Upgrading

```bash
cd ~/virtualoffice && git pull
cd contrib/docker
docker compose build && docker compose up -d
```

Migrations run automatically before `admin-api` binds its port. Forward-only: rolling back the code is
`git checkout <tag>` + rebuild, but the database stays — never restore an old dump over a newer schema without
reading the migration list first.

## Rollback and emergencies

| Situation | Action |
|---|---|
| Bad deploy | `git checkout <last-good>` → `docker compose build && docker compose up -d` |
| Suspected credential leak | rotate the leaked value in `.env` → `docker compose up -d`. Rotating `SECRET_KEY` logs **everyone** out (that is the point) |
| Admin locked out | `docker compose restart admin-api` — the bootstrap re-grants `ADMIN_API_BOOTSTRAP_ADMIN_EMAIL` |
| World down, cause unknown | `docker compose ps` + `docker compose logs play admin-api` — a dead `admin-api` hangs `play` by design (ADR-0002, Trap #2) |

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Browser warns about the certificate | DNS not propagated when Traefik first asked, or Let's Encrypt rate-limited. `docker compose restart reverse-proxy`; for repeated attempts, uncomment the staging CA line in the compose first. |
| `play` restarts forever | `admin-api` unhealthy — `docker compose logs admin-api`. Usually a missing required `.env` value; the startup log names it. |
| Login loops back to Microsoft with an error | Redirect URI mismatch (`AADSTS50011`) — the domain in `.env` and the one in the app registration must match byte for byte. |
| Camera/mic never asked for | You are not on HTTPS. WebRTC requires it; there is no HTTP mode. |
| Video fails only for some people | Their network blocks P2P — that is what section 8's coturn is for. |
| `/admin` answers 503 | The dashboard is missing configuration; `docker compose logs admin-api` names which variable. |
| Build dies out of memory | Close other loads, or build one service at a time: `docker compose build play` etc. 16 GB is enough for the whole set. |

## Costs

The VPS plan is the whole recurring cost. Entra ID app registrations are free; Let's Encrypt is free; coturn rides
the same VPS and its relay traffic fits comfortably inside 16 TB (thirty users relaying continuously would be
~3-4 TB/month, and most traffic never relays).

## References

- [SETUP-CLOUD-AZURE.md](SETUP-CLOUD-AZURE.md) — the app registration, rotation, AADSTS table
- [SETUP-ADMIN-API.md](SETUP-ADMIN-API.md) — permissions, moderation, the CLI, lockout recovery
- [Threat model](security/threat-model.md) — the go-live checklist this guide's secrets section implements
- [contrib/docker/README.md](../contrib/docker/README.md) — the upstream self-hosting notes this guide builds on

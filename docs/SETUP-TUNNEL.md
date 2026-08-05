# Setup — production through a tunnel (ngrok, no VPS)

> **Purpose.** Run the production stack on a machine you already own and publish it through a tunnel with a fixed
> URL — no VPS, no purchased domain. Written for ngrok's free static domain; a Cloudflare quick-tunnel variant is at
> the end.
> **Audience.** Whoever runs the pilot from their own machine (Windows + Docker Desktop assumed).
> **Scope.** A pilot, honestly: the tunnel free tiers are not a 24/7 channel. Promotion paths at the end.
> **Languages.** This file (en-US) + [SETUP-TUNNEL.pt-BR.md](SETUP-TUNNEL.pt-BR.md), in lockstep.

## How it differs from the VPS deploy

Same production compose, two differences:

1. **TLS ends at the tunnel's edge**, so the origin serves plain HTTP. That is what
   [`docker-compose.tunnel.yaml`](../contrib/docker/docker-compose.tunnel.yaml) does: stacked on top of the
   production file, it removes Traefik's HTTPS redirect and the Let's Encrypt resolver. (Traefik logs warnings about
   the dropped `-ssl` routers — expected; the `web` routers serve every route.)
2. **The `DOMAIN` is the tunnel's hostname** (e.g. `your-name.ngrok-free.dev`). Because it is *static* on ngrok's
   free plan, Entra ID callbacks are registered **once** — the thing a random-URL tunnel cannot give you.

Everything else — admin-api, the dashboard at `/admin`, moderation, the map editor — works exactly as on the VPS.

## Prerequisites

- Docker Desktop (WSL2). Give it memory for the build: Settings → Resources, or `.wslconfig` with `memory=12GB`.
- An [ngrok account](https://dashboard.ngrok.com) (free), the agent installed, and your **static domain** claimed
  (dashboard → Domains). The agent must be authenticated once: `ngrok config add-authtoken <token>`.
- Azure CLI for the Entra step, logged into your tenant.
- The development stack **stopped** — it holds ports 80/443 and your RAM:

```bash
docker compose down          # at the repository root
```

## 1. Configure

```bash
cd contrib/docker
cp .env.prod.template .env   # skip if a filled .env already exists
```

Fill in (each secret generated, none reused — `openssl rand -base64 48`):

| Variable | Value |
|---|---|
| `DOMAIN` | your static domain, e.g. `your-name.ngrok-free.dev` — **no scheme** |
| the five secrets + `MAP_STORAGE_AUTHENTICATION_PASSWORD` | generated values |
| `ADMIN_API_BOOTSTRAP_ADMIN_EMAIL` | the email you sign into **Entra** with |
| `ACME_EMAIL` | anything — unused in tunnel mode |
| `OPENID_*` block | next step |

## 2. Entra ID (once — the URL never changes)

```bash
pwsh docs/index/setup-entra-id.ps1 -PlayUrl https://<your-domain> -AdminApiUrl https://<your-domain>
```

Same hostname in both parameters. Paste the printed `OPENID_*` block into `.env`.

> **On Windows PowerShell 5.1** (the default, where `pwsh` does not exist), run `.\docs\index\setup-entra-id.ps1`
> with the same parameters — the script is 5.1-compatible by design. What is actually missing is the Azure CLI:
> `winget install --exact --id Microsoft.AzureCLI`, **close and reopen the terminal**, then `az login`.

Details and AADSTS troubleshooting: [SETUP-CLOUD-AZURE.md](SETUP-CLOUD-AZURE.md).

## 3. Build and start

```bash
cd contrib/docker
docker compose -f docker-compose.prod.yaml -f docker-compose.tunnel.yaml build    # first time: 20-40 min
docker compose -f docker-compose.prod.yaml -f docker-compose.tunnel.yaml up -d
docker compose -f docker-compose.prod.yaml -f docker-compose.tunnel.yaml logs -f play   # until "Remote admin api connection successful"
```

## 4. Open the tunnel

```bash
ngrok http --url=<your-domain> 80
```

(Older agents: `--domain=` instead of `--url=`.) Leave it running; closing the terminal closes the office.

## 5. First map and first login

1. `https://<your-domain>/map-storage/` — Basic auth from `.env` → upload the office map
   (the repository's `maps/office.zip`, or the [map starter kit](https://github.com/workadventure/map-starter-kit)).
2. `https://<your-domain>` in a private window → ngrok's one-time interstitial ("Visit Site") → Microsoft sign-in →
   the office.
3. `https://<your-domain>/admin` → the dashboard; the bootstrap granted your email `admin`.

## Verification

```bash
docker compose -f docker-compose.prod.yaml -f docker-compose.tunnel.yaml exec admin-api npm run member:list
```

Your email with `admin`; then the human checklist: walk, meet in a bubble (video), grant `editor` and edit the map,
ban a test account from `/admin` → Moderation and watch it leave and fail to return.

## The free-tier fine print

| Limit | Meaning here |
|---|---|
| **Interstitial page** | Every visitor clicks through an ngrok warning once. Fine internally; unpolished for anything else. |
| **Bandwidth/request quota** (~1 GB/month; verify current numbers) | A virtual office streams websockets all day. A pilot fits; daily whole-team use will not. Video is P2P and does not count against it. |
| **No UDP** | No TURN, ever, through a tunnel. Video is pure P2P — strict corporate networks may fail. |
| Your machine is the server | It must stay on; your upload link carries the traffic (5-10 users comfortably on typical home fiber). |
| One shared client IP | The dashboard's login rate limiter sees everyone as one address; simultaneous failed logins may throttle the group briefly. |

## Stopping, and going back to development

```bash
# stop the tunnel: Ctrl+C on ngrok
cd contrib/docker && docker compose -f docker-compose.prod.yaml -f docker-compose.tunnel.yaml down
cd ../.. && docker compose up -d     # the dev stack again
```

Volumes survive `down`: members, tags, bans and uploaded maps are all kept for the next pilot session.

## Variant: Cloudflare quick tunnel (no account, random URL)

For an **anonymous demo** only — the URL changes every restart, so Entra cannot be sensibly registered:
set `DISABLE_ANONYMOUS=false` in `.env` (visitors enter with no login and no tags), leave the `OPENID_*` block
empty, then:

```bash
cloudflared tunnel --url http://localhost:80
```

and set `DOMAIN` to the hostname it prints (recreate the stack). The dashboard has no usable login in this mode —
moderation via the CLI if needed.

## Promotion paths

- **Stable, always-on, 30 people:** the VPS — [SETUP-DEPLOY.md](SETUP-DEPLOY.md). The `.env` you built here moves
  with you; only `DOMAIN` and the certificates story change.
- **Keep tunneling but from a real domain (~R$40/year):** Cloudflare named tunnel + Access —
  [SETUP-CLOUDFLARE.md](SETUP-CLOUDFLARE.md) covers the proxy half; the tunnel keeps this file's compose override.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `ERR_NGROK_...` on start | Agent not authenticated (`ngrok config add-authtoken`) or the domain is not claimed on your account. |
| Port 80 busy | The development stack is still up — `docker compose down` at the repository root. |
| Build dies out of memory | Raise Docker Desktop/WSL2 memory (12 GB is comfortable); or build one service at a time. |
| Microsoft login bounces with `AADSTS50011` | The registered redirect URIs and `DOMAIN` differ — byte for byte, scheme included. |
| Page loads but websocket dies | You changed `DOMAIN` after `up` — recreate: `docker compose ... up -d --force-recreate play admin-api`. |
| Everyone suddenly logged out | You rotated `SECRET_KEY`. That is what it is for. |

# Setup — production behind Cloudflare

> **Purpose.** Put the Cloudflare proxy in front of the VPS deploy: WAF/DDoS at the edge, hidden origin IP, and
> optionally a second authentication wall on `/admin`. Four adjustments are mandatory; this walks through each.
> **Audience.** Whoever operates the server, after (or while) following [SETUP-DEPLOY.md](SETUP-DEPLOY.md).
> **Cost.** The free plan is enough for everything here except where marked.
> **Languages.** This file (en-US) + [SETUP-CLOUDFLARE.pt-BR.md](SETUP-CLOUDFLARE.pt-BR.md), in lockstep.

## What goes through Cloudflare, and what never will

| Traffic | Through the proxy? |
|---|---|
| World, `/admin`, `/map-storage`, `/api` | ✅ normal HTTP |
| The pusher's websockets (`/ws/`) | ✅ proxied on every plan |
| Peer-to-peer video between browsers | — never touches the server *or* Cloudflare |
| **TURN (coturn, ports 3478/5349/UDP)** | ❌ **the proxy only carries HTTP ports** — this is adjustment #2 |
| Room API gRPC (50051) | ❌ not proxiable; keep it firewall-closed |

Everything below assumes the single-domain layout from the deploy guide (`office.example.com`).

## Prerequisites

- The stack deployed (or being deployed) per [SETUP-DEPLOY.md](SETUP-DEPLOY.md).
- The domain added as a site on Cloudflare, **nameservers switched** at the registrar, zone active.
- Five minutes of tolerance for DNS propagation between steps.

## 1. DNS records — one orange, one grey

In the Cloudflare DNS panel:

| Type | Name | Content | Proxy |
|---|---|---|---|
| `A` | `office.example.com` | VPS IP | **Proxied** (orange cloud) |
| `A` | `turn` | VPS IP | **DNS only** (grey cloud) |

The grey record is not optional. TURN speaks its own protocol on its own ports; behind the orange cloud the
hostname resolves to Cloudflare edges, which do not forward it — video would fail precisely for the people on
restrictive networks, silently. The grey record does reveal the VPS IP to whoever looks; if hiding the origin
matters to you, TURN is the piece to move to a separate cheap host later.

## 2. SSL mode — Full (strict), never Flexible

Cloudflare panel → SSL/TLS → Overview → **Full (strict)**.

"Flexible" makes Cloudflare talk plain HTTP to the origin; Traefik answers every HTTP request with a redirect to
HTTPS, and the two chase each other in an infinite redirect loop. Full (strict) requires a valid certificate on the
origin — which is the next step.

## 3. Origin certificates — switch Traefik from HTTP-01 to DNS-01

The deploy guide's default uses the HTTP challenge on port 80, which turns fragile behind the proxy. The DNS
challenge is immune to it (and keeps working even with the proxy off later).

Create the token: Cloudflare panel → My Profile → API Tokens → Create Token → template **Edit zone DNS** → scope it
to this one zone. Add it to `contrib/docker/.env`:

```dotenv
CF_DNS_API_TOKEN=<the token>
```

In `contrib/docker/docker-compose.yaml` (your renamed copy of `docker-compose.prod.yaml`), replace the challenge
line in the `reverse-proxy` command block:

```yaml
      # HTTP challenge                                           # ── REMOVE this pair ──
      - --certificatesresolvers.myresolver.acme.httpchallenge.entrypoint=web

      # DNS challenge (Cloudflare)                               # ── ADD this pair ──
      - --certificatesresolvers.myresolver.acme.dnschallenge.provider=cloudflare
      - --certificatesresolvers.myresolver.acme.dnschallenge.resolvers=1.1.1.1:53
```

and give the token to the container, in the same service:

```yaml
    environment:
      CF_DNS_API_TOKEN: "${CF_DNS_API_TOKEN}"
```

Then `docker compose up -d reverse-proxy`. (The alternative — a Cloudflare **Origin Certificate** mounted into
Traefik — also satisfies Full (strict), but it is only trusted by Cloudflare, so the grey-cloud TURN hostname and
any proxy-off rollback would need certificates of their own. DNS-01 covers every case with one mechanism.)

## 4. Real client IPs — teach Traefik to trust Cloudflare

Behind the proxy, Traefik sees Cloudflare's addresses, so the dashboard's login rate limiter would lump the whole
office into a handful of IPs. Add to the `reverse-proxy` command block (both entry points):

```yaml
      - --entryPoints.web.forwardedHeaders.trustedIPs=173.245.48.0/20,103.21.244.0/22,103.22.200.0/22,103.31.4.0/22,141.101.64.0/18,108.162.192.0/18,190.93.240.0/20,188.114.96.0/20,197.234.240.0/22,198.41.128.0/17,162.158.0.0/15,104.16.0.0/13,104.24.0.0/14,172.64.0.0/13,131.0.72.0/22,2400:cb00::/32,2606:4700::/32,2803:f800::/32,2405:b500::/32,2405:8100::/32,2a06:98c0::/29,2c0f:f248::/32
      - --entryPoints.websecure.forwardedHeaders.trustedIPs=173.245.48.0/20,103.21.244.0/22,103.22.200.0/22,103.31.4.0/22,141.101.64.0/18,108.162.192.0/18,190.93.240.0/20,188.114.96.0/20,197.234.240.0/22,198.41.128.0/17,162.158.0.0/15,104.16.0.0/13,104.24.0.0/14,172.64.0.0/13,131.0.72.0/22,2400:cb00::/32,2606:4700::/32,2803:f800::/32,2405:b500::/32,2405:8100::/32,2a06:98c0::/29,2c0f:f248::/32
```

The ranges are published at <https://www.cloudflare.com/ips/> — they change rarely; re-check when Cloudflare
announces changes. `ADMIN_API_TRUST_PROXY=1` (already the default) then does the rest.

## 5. TURN — point it at the grey hostname

In `.env`:

```dotenv
TURN_SERVER=turn:turn.office.example.com:3478
TURN_STATIC_AUTH_SECRET=<the secret from the deploy guide's coturn section>
```

`realm=turn.office.example.com` in `/etc/turnserver.conf` to match. `docker compose up -d` to re-read.

## 6. Optional — restrict ports 80/443 to Cloudflare only

With the proxy in front, nothing legitimate reaches those ports directly. Closing them to the world hides the
origin from scanners:

```bash
for ip in $(curl -s https://www.cloudflare.com/ips-v4); do sudo ufw allow from $ip to any port 80,443 proto tcp; done
for ip in $(curl -s https://www.cloudflare.com/ips-v6); do sudo ufw allow from $ip to any port 80,443 proto tcp; done
sudo ufw delete allow 80/tcp && sudo ufw delete allow 443/tcp
```

The TURN ports (3478, 5349, 49152–49352/udp) stay open to everyone — that traffic does not come through Cloudflare.
Skip this step until everything else is verified: it makes debugging with `curl` from your machine impossible.

## 7. Optional — Cloudflare Access in front of `/admin` (defence in depth)

Zero Trust panel → Access → Applications → Add → Self-hosted:

- Application domain: `office.example.com`, path `admin`
- Policy: allow your company emails (or your Entra ID as the Access identity provider)

Requests to `/admin*` then authenticate at the edge **before** reaching the dashboard's own session barrier. Two
walls, different owners. The dashboard's own login continues unchanged behind it. (Free plan covers up to 50 users.)

## Verification

```bash
dig +short office.example.com          # Cloudflare IPs (104.x/172.x...), NOT the VPS
dig +short turn.office.example.com     # the VPS IP, exactly
curl -sI https://office.example.com | grep -iE "server|cf-ray"   # server: cloudflare + a cf-ray id
```

Then the human checks: log in through Entra (unchanged), meet in a bubble, and — the one that proves adjustment #5 —
have somebody on a restrictive network (mobile hotspot with VPN, corporate Wi-Fi) get video. In
`chrome://webrtc-internals` their connection should show a `relay` candidate naming `turn.office.example.com`.
Finally, `docker compose logs admin-api | grep "login"` after a failed login: the logged IP must be the person's
real one, not a Cloudflare range — that is adjustment #4 working.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Infinite redirect loop | SSL mode is Flexible. Set Full (strict). |
| Certificate errors after switching | DNS-01 not issuing: token lacks Zone DNS Edit on this zone, or `CF_DNS_API_TOKEN` not reaching the container (`docker compose logs reverse-proxy | grep -i acme`). |
| Video broken only on strict networks | The `turn` record got orange-clouded, or `TURN_SERVER` still points at the main domain. `dig` it: it must answer the VPS IP. |
| Login rate limiter triggering for everyone | Adjustment #4 missing — Traefik is reporting Cloudflare's IP for every visitor. |
| Map upload dies at ~100 s | Cloudflare's free-plan proxy timeout. Upload from a machine close to the server, split the map, or temporarily grey-cloud the record for the upload. |
| Everything down after step 6 | The UFW loop ran before `ufw delete` — order matters; re-run the allows, then the deletes. |

## Rolling back

Set the main record to **DNS only** (grey) and traffic goes direct to the VPS again — the DNS-01 certificates keep
working, nothing else to undo. That is the whole rollback, reversible in one click.

## References

- [SETUP-DEPLOY.md](SETUP-DEPLOY.md) — the deploy this sits in front of
- [Cloudflare IP ranges](https://www.cloudflare.com/ips/) — refresh source for adjustment #4 and step 6
- [Traefik DNS-01 with Cloudflare](https://doc.traefik.io/traefik/https/acme/#dnschallenge) — the resolver options
- [Threat model](security/threat-model.md) — where the origin-hiding and `/admin` defence-in-depth fit

# ADR-0004: Admin dashboard (Admin API, P2)

- **Status:** Proposed
- **Date:** 2026-07-31
- **Deciders:** VirtualOffice team
- **Languages:** [0004-admin-dashboard.pt-BR.md](0004-admin-dashboard.pt-BR.md) (pt-BR) + this file (en-US), in lockstep.
- **Origin:** [ADR-0002](0002-admin-api.md), phase P2. Revises its decision #3. Follows [ADR-0003](0003-member-and-tag-management.md).

> This ADR is **Proposed**, not Accepted: decisions #1 to #4 are recommendations, and the *Open questions* at the end
> need the team's answer before implementation starts.

## Context

P0 and P1 are delivered. Tags live in Postgres, `canEdit` follows them, and the CLI from ADR-0003 ended hand-written
SQL. But the CLI needs `docker compose exec` — which means shell access to the container, which means permission
management is still an engineer's job.

P2 is what finishes the sentence the roadmap started with: *"I can't fix the tags"*. Not because the data is missing
any more, but because changing it is not yet something a person without a terminal can do.

Scope: list and search members, grant and revoke tags, set display names, and view rooms. Authenticated, and only for
administrators.

## Decision 1 — An embedded Svelte UI, not a separate Next.js application

**This revises [ADR-0002](0002-admin-api.md) decision #3**, which called for a "separate front (Next.js)".

That decision was made before anyone looked at what the repository already does. `map-storage` ships
[`src-ui/`](../../map-storage/src-ui): a **Svelte 5 + Vite** interface, built by `vite build` and served by the same
service, routed by Traefik under a path prefix on the service's own host. It is precisely the shape P2 needs, already
working, already in the toolchain.

What we keep from decision #3: the dashboard consumes **`admin-api`'s own API**, never the endpoints the pusher uses.

| | Embedded Svelte | Separate Next.js |
|---|---|---|
| Deployment units | 1 | 2 |
| CORS | none — same origin | needed |
| Auth surfaces | 1 | 2, or a shared cookie domain |
| Toolchain | already in the repo | new |
| SSR | not needed behind a login | its main selling point, unused |

Next.js would be the right answer for a public, SEO-relevant, high-traffic front. This is an internal tool behind a
login, used by a handful of people.

**What we give up:** if the dashboard ever needs to be deployed independently of the API — different scaling, a
different team — this has to be split. **The bet:** that will not happen before the dashboard has earned it, and a
Svelte SPA is not hard to lift out.

## Decision 2 — Human authentication via OIDC, gated on the `admin` tag

`ADMIN_API_TOKEN` is a machine secret shared with the pusher. It must **never** authenticate a person: a token that
grants both "serve the pusher" and "grant anyone any permission" is one leak away from a very bad day. This is the
same reasoning that made ADR-0003 choose a CLI over an HTTP management API.

The flow:

```
/admin  →  no session  →  redirect to the OIDC provider
                       →  callback: read the email from the token
                       →  look the member up in our database
                       →  require the "admin" tag
                       →  issue a signed session cookie
```

Authentication answers *who*; **our database** answers *what they may do* — the same separation the roadmap draws
between F2 and F3.

`openid-client@5.7.1` is already a dependency of `play`, so there is nothing new to evaluate. In development the mock
registers `RedirectUris: ["http://*.workadventure.localhost", ...]`, so `http://admin-api.workadventure.localhost/admin/callback`
is already allowed and **no new client registration is needed**. Azure Entra ID will need that redirect URI added
when F2 lands.

> **The circularity is deliberate.** The dashboard that manages tags is protected by a tag it manages. That is exactly
> what ADR-0002's decision #6 — the idempotent bootstrap — exists to break: a fresh environment always has one
> administrator, so there is always a way in.

### Sessions are signed, not stored

The session is a short-lived JWT in an `HttpOnly`, `SameSite=Lax`, `Secure`-in-production cookie, signed with a
secret `admin-api` already needs. No session store, no state to replicate, nothing to lose on restart.

The cost is that a session cannot be revoked before it expires. Mitigated by keeping the lifetime short (recommend
one hour) and by re-checking the `admin` tag on every request rather than trusting the token's copy: a revoked
administrator loses access on their next click, not an hour later.

## Decision 3 — Two route namespaces, two credentials, no overlap

| Namespace | Consumer | Credential |
|---|---|---|
| `/api/*` | the pusher | `ADMIN_API_TOKEN`, raw in `Authorization` |
| `/admin/*` | the dashboard | signed session cookie |

Neither credential is accepted on the other namespace, and that gets an explicit test in both directions. A shared
token that happens to also open the dashboard is the failure this decision exists to prevent.

`/admin/login`, `/admin/callback` and `/admin/logout` are necessarily unauthenticated, and are listed the same way
`/api/capabilities` is: an explicit allowlist inside a guard that protects everything else by default.

## Decision 4 — Authorisation ships **with** P2, not in P4

[ADR-0002](0002-admin-api.md) puts "RBAC on the dashboard itself" in P4. Authentication and "only administrators get
in" cannot wait for a later phase: a dashboard without them is not shippable, it is a public permission editor.

What genuinely belongs in P4 is *refinement* — roles beyond `admin`/`editor`, and per-action permissions.

## Decision 5 — An audit log, in P2 rather than P4

ADR-0002 also defers the audit log to P4. Recommend moving it forward, for one reason: **it cannot be reconstructed
later.** A tag granted in P2 and questioned in P4 has no record of who granted it or when.

The minimum is one append-only table — actor, action, subject, timestamp — written on every mutation the dashboard
performs. It is one migration and a few lines per handler now; it is an unanswerable question later.

## Alternatives considered

### A. Separate Next.js application, as ADR-0002 originally specified
- **Pros:** independent deployment; the framework the team's general standard names.
- **Cons:** a second deployment unit, CORS, a second auth surface and a new toolchain, to gain SSR that a
  login-gated internal tool never uses.
- **Rejected**, superseding decision #3 of ADR-0002.

### B. Reuse `play`'s session
`play` already signs a JWT with `SECRET_KEY`; `admin-api` could verify it and get single sign-on for free.
- **Pros:** no second login; no OIDC client work.
- **Cons:** couples the two services through a shared secret, and the token identifies a **player in a room**, not an
  administrator in a management tool. Their lifetimes, scopes and revocation rules should not be the same.
- **Rejected**, but worth revisiting if a second admin surface ever appears.

### C. Basic authentication, as `map-storage` does for its UI
- **Pros:** trivial; already a pattern in the repo.
- **Cons:** a shared password is not a person. It cannot be revoked for one individual, it cannot be audited, and it
  cannot express "only administrators".
- **Rejected.** It is acceptable for map uploads; it is not acceptable for editing permissions.

### D. No dashboard — extend the CLI
- **Pros:** no new surface at all.
- **Cons:** leaves permission management requiring container shell access, which is the thing P2 exists to end.
- **Rejected.**

## Consequences

### Positive
- Permission management stops requiring a terminal, which is the roadmap's original goal.
- Human authentication and machine authentication stay separate, each with the right lifetime and revocation.
- No new deployment unit, no CORS, no second toolchain.

### Negative
- `admin-api` gains a browser-facing surface, and with it session handling, CSRF considerations on mutations, and a
  build step for the UI.
- A signed session cannot be revoked before it expires; mitigated by a short lifetime and re-checking the tag per
  request.
- The dashboard's own availability now matters — though never to the point of affecting `play`, which only talks to
  `/api/*`.

### Neutral
- ADR-0002's decision #3 is superseded in its "separate Next.js front" half and kept in its "consumes our own API"
  half.

## Implementation plan

| Slice | Scope |
|---|---|
| **G0** | The security spine: OIDC login, callback, signed session cookie, the `admin` gate, `/admin/logout`, and `GET /admin/me`. No UI. |
| **G1** | `/admin/api/*`: members list and search, member detail, grant and revoke a tag, set a name, list tags. Thin handlers over the repositories P1 already built. |
| **G2** | The UI: members screen — search, tags, name. Svelte 5 + Vite under `src-ui/`, following `map-storage`. |
| **G3** | Rooms view, reading from `map-storage`'s `/maps`. |
| **G4** | Audit log, bilingual docs, e2e of login → grant → the tag taking effect in `play`. |

G0 is deliberately first and deliberately UI-free: the security boundary should exist and be tested before anything
is behind it.

## Mandatory tests

1. An anonymous request to any `/admin/*` route redirects to login; an anonymous request to `/admin/api/*` gets 401,
   never a redirect.
2. **`ADMIN_API_TOKEN` does not open `/admin/*`, and a session cookie does not open `/api/*`.** Both directions.
3. A member without the `admin` tag completes the OIDC login and is still refused.
4. Revoking the `admin` tag denies the next request on an existing session — proving the tag is re-checked, not read
   from the token.
5. A tampered or expired session cookie is refused, not treated as anonymous-then-redirected into a loop.
6. Every mutation writes an audit entry naming the actor.
7. Granting a tag through the dashboard changes `canEdit` for that member on their next login, end to end.

## Open questions

1. **Audit log in P2 or P4?** Decision #5 recommends P2, against ADR-0002. It is cheap now and impossible to
   backfill.
2. **Session lifetime.** One hour is the recommendation; anything longer widens the un-revocable window.
3. **Who may reach the dashboard's host?** In production, is `admin-api.<domain>` public, or restricted to a VPN or
   an IP allowlist? OIDC makes it defensible either way, but the answer changes the threat model — and ADR-0002's
   consequences already call for a STRIDE model before this service holds real identity.
4. **A second administrator.** The bootstrap guarantees one. Does the dashboard need "promote another admin" in P2,
   or does that wait? It is the difference between one person being a single point of failure and not.

## References

- [ADR-0002 — Our own Admin API](0002-admin-api.md) — decision #3 (revised here), decision #6 (the bootstrap this depends on)
- [ADR-0003 — Member and tag management](0003-member-and-tag-management.md) — the repositories G1 builds on, and why P1 chose a CLI
- [`map-storage/src-ui`](../../map-storage/src-ui) — the embedded-UI precedent
- [`play/src/pusher/services/OpenIDClient.ts`](../../play/src/pusher/services/OpenIDClient.ts) — how `openid-client` is already used here
- [Setup — `admin-api`](../SETUP-ADMIN-API.md)

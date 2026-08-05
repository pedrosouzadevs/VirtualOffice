# ADR-0004: Admin dashboard (Admin API, P2)

- **Status:** Accepted
- **Date:** 2026-07-31 — open questions answered the same day (decisions #6 to #8)
- **Deciders:** ArqueumSpace team
- **Languages:** [0004-admin-dashboard.pt-BR.md](0004-admin-dashboard.pt-BR.md) (pt-BR) + this file (en-US), in lockstep.
- **Origin:** [ADR-0002](0002-admin-api.md), phase P2. Revises its decision #3. Follows [ADR-0003](0003-member-and-tag-management.md).

> Decisions #1 to #5 were proposed and accepted; #6 to #8 answer the questions this ADR opened. Nothing is left
> pending before implementation starts.

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

`openid-client@5.7.1` is already a dependency of `play`, so there is nothing new to evaluate. Azure Entra ID will need
`http://admin-api.arqueum.localhost/admin/callback` — or its production equivalent — added as a redirect URI
when F2 lands.

> **Correction (2026-07-31, during G0).** This ADR originally claimed the development mock's
> `RedirectUris: ["http://*.arqueum.localhost", ...]` already covered our callback, so that **no new client
> registration was needed**. That is false, and the reason is worth writing down: the mock's wildcard does not match a
> **hyphen** in the hostname. `http://adminapi.arqueum.localhost/...` is accepted; `admin-api` and
> `map-storage` are rejected, whatever the path. The failure surfaces as `invalid_request / Invalid redirect_uri` on
> the provider's own error page, which reads like our misconfiguration and is not.
>
> The callback is therefore registered explicitly in
> [`contrib/oidc-server-mock/clients-config.json`](../../contrib/oidc-server-mock/clients-config.json). Explicit is
> what production requires anyway, so the two environments now differ by one hostname rather than by a mechanism.

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

## Decision 6 — A sliding session, inside an absolute cap

One hour, renewed by activity.

Sliding renewal would be alarming if the cookie carried the authorisation: an active session could then outlive a
revoked administrator indefinitely. It does not. Decision #2 re-checks the `admin` tag **on every request**, so
someone who loses the tag is refused on their next click no matter how fresh their cookie is. Sliding extends *how
long you stay signed in*, never *what you are allowed to do*.

What sliding does still need is an **absolute cap** — recommend 12 hours. Without one, a stolen cookie kept warm by a
script never expires, and "one hour" becomes a number that describes nothing. With the cap, the worst case is
bounded: a stolen session dies within 12 hours even if it is used constantly, and within one hour if it is not.

Renew when less than half the lifetime remains, rather than on every request: re-issuing `Set-Cookie` on each call
costs nothing but noise, and makes the logs harder to read.

## Decision 7 — A public host, with Entra ID as the perimeter

The dashboard is reachable from the internet; Azure Entra ID is what stops people getting in.

That is a defensible choice, and it is the reason not to roll our own authentication: Entra's Conditional Access —
MFA, device compliance, location rules — becomes the real perimeter, and it is a far better one than an IP allowlist
we would have to maintain.

Four things stop being optional the moment the host is public:

- **HTTPS, and the `Secure` flag on the session cookie.** Not a production nicety; without it the cookie crosses the
  internet in the clear.
- **CSRF protection on mutations.** `SameSite=Lax` covers navigation-based attacks, but every state-changing route
  must be a POST/PATCH/DELETE — never a GET — and mutations need `SameSite=Strict` or a CSRF token.
- **Rate limiting on `/admin/login`**, so the OIDC redirect cannot be used as an amplifier against the provider.
- **The STRIDE threat model.** [ADR-0002](0002-admin-api.md) lists it under P4. With a publicly reachable permission
  editor, it belongs **before this goes live**, not after. This ADR moves it.

## Decision 8 — More than one administrator, and how a lockout recovers

Granting `admin` through the dashboard is just granting a tag, so G1 covers it with no special case.

Deliberately left unguarded: an administrator **may** remove their own `admin` tag, including the last one in the
system. That is recoverable rather than fatal, because [ADR-0002](0002-admin-api.md)'s decision #6 bootstrap runs on
**every** startup and re-grants `ADMIN_API_BOOTSTRAP_ADMIN_EMAIL` — restarting `admin-api` restores access.

Documented rather than blocked: a "you cannot remove the last administrator" rule is more code, and more surprise at
the moment someone hits it, than a recovery path that already exists for another reason.

> **Revision (2026-08-01, after the threat model).** The first half of this decision — that granting `admin` is an
> ordinary tag grant — **no longer holds**. Finding F1 of the
> [threat model](../security/threat-model.md#f1--a-stolen-admin-session-can-create-a-permanent-administrator) named
> the asymmetry it created: an attacker holding a dashboard session for a minute could grant `admin` to an address
> they control, and while the session dies within twelve hours the grant does not. A temporary compromise became
> permanent access, surviving session expiry, password reset and revoking the original account.
>
> **`admin` is now assigned only with direct SQL.** Neither the dashboard nor the CLI can grant it — both go through
> `MemberAdministrationService`, which refuses it, records the attempt and raises an alert. Mandatory test #10 is
> superseded by a test asserting the opposite.
>
> The second half stands unchanged: **revoking `admin` is still allowed from either surface**, because needing a DBA
> to remove an administrator during an incident would be the wrong trade. Self-removal still recovers through the
> bootstrap on restart, which grants through the repository rather than through the refusing service.
>
> **What this costs:** a legitimate `admin` grant now leaves no trace at all — SQL bypasses the audit log and the
> alert alike. The trade is deliberate: no application surface can escalate, at the price of the one privilege whose
> assignment is no longer recorded.

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
8. Activity renews the session, and a session still dies at the absolute cap however active it has been.
9. Every state-changing route refuses a GET, and a mutation without the CSRF defence is rejected.
10. An administrator can grant `admin` to someone else, and the new administrator can sign in.

## Points confirmed (2026-07-31)

1. ✅ **Audit log in P2**, not P4 (decision #5). It cannot be backfilled.
2. ✅ **Session: one hour, renewed by activity, inside a 12-hour absolute cap** (decision #6). Safe because the
   `admin` tag is re-checked per request, so sliding never extends authorisation.
3. ✅ **Public host, Entra ID as the perimeter** (decision #7). HTTPS, `Secure`, CSRF and login rate limiting stop
   being optional, and the STRIDE model moves ahead of go-live.
4. ✅ **Several administrators** (decision #8). Granting `admin` is an ordinary tag grant; self-removal is allowed
   and recovers through the bootstrap on restart.

No pending point blocks the start of G0.

## References

- [ADR-0002 — Our own Admin API](0002-admin-api.md) — decision #3 (revised here), decision #6 (the bootstrap this depends on)
- [ADR-0003 — Member and tag management](0003-member-and-tag-management.md) — the repositories G1 builds on, and why P1 chose a CLI
- [`map-storage/src-ui`](../../map-storage/src-ui) — the embedded-UI precedent
- [`play/src/pusher/services/OpenIDClient.ts`](../../play/src/pusher/services/OpenIDClient.ts) — how `openid-client` is already used here
- [Setup — `admin-api`](../SETUP-ADMIN-API.md)

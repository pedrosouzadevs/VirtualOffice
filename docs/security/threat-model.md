# Threat model — `admin-api` and the administration dashboard

- **Status:** Current as of 2026-07-31, covering ADR-0004 phases G0–G4
- **Audience:** anyone changing `admin-api`, and whoever signs off on making the dashboard publicly reachable
- **Languages:** this file (en-US) + [threat-model.pt-BR.md](threat-model.pt-BR.md), in lockstep
- **Method:** [STRIDE](https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-threats)

> Written because [ADR-0004](../adr/0004-admin-dashboard.md) decision #7 moved it ahead of go-live. A publicly
> reachable permission editor is not something to threat-model afterwards.
>
> Most of what follows is a record of decisions already made. The value is in [§6](#6-open-findings), which is what
> is *not* handled.

## 1. Scope

`admin-api` — both of its route spaces:

| Space | Consumer | Credential |
|---|---|---|
| `/api/*` | the `play` pusher | `ADMIN_API_TOKEN`, a shared secret |
| `/admin/*` | a person's browser | a signed session cookie |

Out of scope: `play`, `back`, `map-storage` and the media server have their own surfaces. They appear here only where
`admin-api` trusts them.

## 2. What we are protecting

Ranked by what losing it costs.

| Asset | Why it matters |
|---|---|
| **The permission database** (`member`, `tag`, `member_tag`) | Decides who may edit maps and who may administer. Writing to it is the whole point of attacking this service. |
| **Availability of `/api/*`** | The pusher retries it without a cap *before* opening its own port. `admin-api` being down does not degrade `play` — it hangs it (ADR-0002, Trap #2). |
| **The audit log** (`audit_log`) | The only record of who changed what. Worthless if it can be edited, and unreconstructible if it has gaps. |
| **`ADMIN_API_SESSION_SECRET`** | Signs session cookies. Whoever has it can mint an administrator. |
| **`ADMIN_API_TOKEN`** | Opens `/api/*`. Shared with `play`. |
| **Member emails** | Personal data under the LGPD. Low volume, but it is a directory of who works here. |

## 3. Trust boundaries

1. **Browser → `/admin/*`** — untrusted human input, authenticated by OIDC, authorised by our database.
2. **Pusher → `/api/*`** — a machine holding a shared secret. Everything it sends is caller-controlled.
3. **`admin-api` → Postgres** — ours alone; no other service has credentials.
4. **`admin-api` → the OIDC provider** — external. It answers *who*; it never decides *what they may do*.
5. **`admin-api` → `map-storage`** — in-network and **unauthenticated**. See [F3](#f3--the-room-catalogue-is-readable-by-anything-on-the-network).

## 4. STRIDE walk

### S — Spoofing: pretending to be someone else

**Handled.** Identity comes from the OIDC provider, never from a claim we let the caller supply. The session is a
JWT signed with HS256 and a dedicated secret, with the algorithm pinned on verification — an `alg: none` forgery is
refused, and there is a regression test for it. The pusher's `ADMIN_API_TOKEN` is compared with a timing-safe
digest, and it does not open `/admin/*` at all: the barrier never reads the `Authorization` header.

The session secret is deliberately **not** `ADMIN_API_TOKEN`. One secret that both served machines and minted human
sessions would turn a single leak into impersonation of any administrator.

**Residual:** anyone holding `ADMIN_API_SESSION_SECRET` can mint a session for any email. This is inherent to signed
sessions and is why the secret is a first-class asset above.

### T — Tampering: modifying data

**Handled.** The session cookie is signed, so its contents cannot be edited — a tampered payload fails verification
and is treated as no cookie at all. Mutations require an `X-CSRF-Token` header matching a claim inside that signed
cookie, which a cross-origin page can neither read nor set. `SameSite=Lax` blocks cross-site POSTs on its own; the
token is the second layer. Every state-changing route is POST/PATCH/DELETE — `GET /admin/logout` is a 404, tested.

`returnTo` is reduced to an in-app `/admin/` path on both write and read, so the post-login redirect cannot be aimed
off-site.

**Residual:** the CSRF token is compared with `!==` rather than a timing-safe primitive. Exploiting that would mean
issuing many requests already carrying a valid session cookie, at which point the attacker has the session anyway.
Noted, not fixed.

### R — Repudiation: denying you did it

**Mostly handled.** `audit_log` is append-only — actor, action, target, timestamp, details — and there is no code
path that updates or deletes a row. The write lives in the shared Application service, so the CLI cannot bypass what
the dashboard records. Entries store emails as **snapshots with no foreign keys**, so history survives the person
being renamed or deleted.

**Residual:** see [F2](#f2--cli-changes-cannot-name-a-person) and [F4](#f4--a-failed-audit-write-does-not-fail-the-request).

### I — Information disclosure: seeing what you should not

**Mostly handled.** Everything under `/admin` is guarded by default; opening a path takes a deliberate edit to an
allowlist. The internal primary key never leaves the database — the email is the only identifier that does
(ADR-0002, decision #5). Cookies are `HttpOnly` (except the CSRF companion, which is worthless alone), scoped to
`Path=/admin` so a browser will not even offer them to `/api/*`, and `Secure` whenever the public URL is HTTPS.

The 503 for an unconfigured dashboard is deliberately vague; which variable is missing goes to the startup log,
where an operator can see it, and not to an anonymous caller.

**Residual:** see [F3](#f3--the-room-catalogue-is-readable-by-anything-on-the-network) and
[F5](#f5--refused-logins-put-an-email-in-the-operational-log).

### D — Denial of service

**Partly handled.** `/admin/login` is rate-limited so its redirect cannot be pointed at the identity provider as an
amplifier. The dashboard is architecturally incapable of taking `/api/*` down with it: a missing configuration
disables `/admin/*` with a 503, an unbuilt UI is simply not served, and an unreachable `map-storage` is a 502 on one
screen. Calls out to the identity provider and to `map-storage` both have timeouts, so a wedged dependency cannot
hold requests open indefinitely.

**Residual:** see [F6](#f6--only-the-login-is-rate-limited).

### E — Elevation of privilege

**Partly handled.** The `admin` tag is re-read from Postgres on **every** request rather than trusted from the
token, so a revoked administrator is refused on their next click rather than an hour later. Authorisation never
comes from an OIDC claim — the provider answers *who*, our database answers *what*. The sliding session extends how
long you stay logged in, never what you may do.

**Residual:** see [F1](#f1--a-stolen-admin-session-can-create-a-permanent-administrator), which is the finding that
matters most.

## 5. Attacks considered and dismissed

| Attack | Why it does not work |
|---|---|
| Replaying a spent OIDC callback | The transaction cookie is single-use and cleared on every path out of the callback, success or failure. |
| Forcing a login through a link (login CSRF) | The OIDC `state` travels in a signed cookie and is verified by `openid-client`. |
| Session fixation | The session is minted at the callback; nothing the caller sends influences its contents. |
| Escaping the map tree via the areas route | Paths containing `..` or starting with `/` are refused before reaching `map-storage`. |
| Locking everyone out by removing the last admin | Allowed on purpose. The bootstrap re-grants on every startup, so restarting `admin-api` restores access (ADR-0004, decision #8). |

## 6. Open findings

Ranked. None is blocking today because the dashboard is not yet publicly reachable — which is exactly the condition
that changes.

### F1 — A stolen admin session can create a permanent administrator

**Severity: high.** An attacker with an administrator's browser session for even a minute can grant `admin` to an
address they control. The session dies within 12 hours; the grant does not. A temporary compromise becomes
permanent access that survives session expiry, password reset and revoking the original account.

Granting `admin` through the dashboard is deliberate (ADR-0004, decision #8) and has a mandatory test. The question
this model raises is not whether to allow it, but whether it should be *silent*.

**Options:**

| | Effect | Cost |
|---|---|---|
| **a. Accept, lean on the provider** | Entra Conditional Access — MFA, device compliance — is the real perimeter, which is decision #7's premise | none |
| **b. Alert on `admin` grants** | Turns permanent-and-silent into permanent-and-noticed. The audit log already records it; nobody reads it | small |
| **c. Move `admin` grants to the CLI only** | A stolen browser session could no longer create a backdoor administrator | revises decision #8 and mandatory test #10 |
| **d. Require a second administrator to approve** | Removes the single point of compromise | large; real friction for a small team |

**Recommendation: (a) + (b).** Keep decision #8, and make an `admin` grant something a human is told about rather
than something buried in a table. Revisit (c) if the dashboard is ever reachable without Conditional Access in front
of it.

### F2 — CLI changes cannot name a person

**Severity: medium.** Entries written by `npm run member:grant` and friends are attributed to `cli`, because a
command run inside the container has no logged-in identity. It is honest, and it is still a repudiation gap: "who
granted this" has no answer whenever the terminal was used.

**Mitigation:** treat shell access to the container as the privileged act it is, and prefer the dashboard for
routine changes now that it exists.

### F3 — The room catalogue is readable by anything on the network

**Severity: low.** `GET /maps` and the `.wam` files on `map-storage` are unauthenticated — the same call `play`
makes. So the list of rooms, and the owners of personal areas inside them, are readable by any process on the Docker
network. This is `map-storage`'s decision and not one `admin-api` can tighten; the dashboard's own copy is behind
the session barrier.

**Mitigation:** network segmentation. Worth raising upstream if the map tree ever holds anything sensitive.

### F4 — A failed audit write does not fail the request

**Severity: low.** The audit entry is written after the mutation, and a failure is logged rather than propagated:
the change already landed, so answering with an error would misdescribe the world. The realistic cause — a database
that is down or full — would have stopped the mutation first, so the gap is narrow and correlated rather than
general.

**Mitigation:** accepted. Closing it properly means one transaction across both writes, which is a unit-of-work
across two ports; revisit if the log is ever used for compliance evidence rather than for answering questions.

### F5 — Refused logins put an email in the operational log

**Severity: low.** A dashboard login refused for a missing `admin` tag logs the address. The project's own rule is
to redact personal data in logs by default; the counter-argument is that a refused administrative login is exactly
the event an operator needs to see named.

**Decision needed:** confirm this as an intentional exception, or redact and rely on the audit log.

### F6 — Only the login is rate-limited

**Severity: low.** `/admin/api/*` has no throttle. Every route there requires a valid session and re-reads the admin
tag from Postgres on each request, so the exposure is an authenticated administrator hammering their own database —
not an anonymous one.

**Mitigation:** revisit if the dashboard is exposed without a proxy that rate-limits, or if `/admin/api` ever serves
anything expensive.

### F7 — The session secret is still a development default

**Severity: high on the day it goes public, none today.** `ADMIN_API_SESSION_SECRET` in `.env.template` and
`docker-compose.yaml` is a known constant. Anyone with it can mint a session for any email.

**Action:** generate a real one (`openssl rand -base64 48`) before any deployment that is not a local clone. This is
a go-live checklist item, not a code change.

## 7. Before go-live

- [ ] **F7** — replace `ADMIN_API_SESSION_SECRET` with a generated value
- [ ] **F1** — decide between the options above; implement (b) if chosen
- [ ] HTTPS confirmed on a real deployment, and the session cookie observed carrying `Secure`
- [ ] `ADMIN_API_TRUST_PROXY` matching the actual topology — `false` if nothing sits in front, or the login rate
      limit can be walked around with a forged `X-Forwarded-For`
- [ ] **F5** — confirm or redact

## 8. Review

Revisit when a new route space appears, when a new external dependency is trusted, or when the exposure changes —
whichever comes first. Each of those is a change to [§3](#3-trust-boundaries), and a trust boundary that moved
without this document moving is the thing that makes threat models go stale.

## References

- [ADR-0002 — the Admin API](../adr/0002-admin-api.md) — the contract and its traps
- [ADR-0004 — the dashboard](../adr/0004-admin-dashboard.md) — decisions #2, #3, #6, #7 and #8
- [Setup — `admin-api`](../SETUP-ADMIN-API.md)
- OWASP Top 10, and the OWASP Top 10 for LLM Applications where AI features arrive

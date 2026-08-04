# Setup — Azure Entra ID (F2)

> **Purpose.** Point VirtualOffice's login at Azure Entra ID instead of the development OIDC mock — the *config swap*
> the roadmap chose for F2 (option A: no multi-provider; dev keeps the mock, production uses Entra).
> **Audience.** Whoever administers the Azure tenant and operates the deployment.
> **Languages.** This file (en-US) + [SETUP-CLOUD-AZURE.pt-BR.md](SETUP-CLOUD-AZURE.pt-BR.md), in lockstep.

## Overview

One **app registration** serves both login surfaces, because both services are deliberately configured from the same
`.env` values (they cannot drift apart):

| Surface | Callback that must be registered |
|---|---|
| The world (`play`) | `<PLAY_URL>/openid-callback` and `<PLAY_URL>/logout-callback` |
| The administration dashboard (`admin-api`) | `<ADMIN_API_PUBLIC_URL>/admin/callback` |

Identity is all Entra provides. **Authorisation stays in `admin-api`'s Postgres** (F3): the pusher stops reading the
OIDC tags claim the moment `ADMIN_API_URL` is set, so there is no App Role or group mapping to configure — the
mapping work the original spec expected was made obsolete by F3.

What switching changes for people: everyone signs in with their Microsoft account, and their **email** is their
identity everywhere — the member row, the audit log, personal-area ownership. Tags they held keep working, because
tags are attached to the email in our database, not to the provider.

## Prerequisites

- An Entra ID tenant containing your users, and an account allowed to create app registrations
  (Application Developer role is enough).
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) 2.60+, logged in: `az login --tenant <tenant>`.
- The public URLs of both surfaces, HTTPS, decided beforehand. Entra refuses `http://` redirect URIs for anything
  but localhost — there is no wildcard forgiveness like the mock's.
- `ADMIN_API_SESSION_SECRET` replaced with a generated value (threat model F7): `openssl rand -base64 48`.

## Cost

Zero. App registrations and OIDC sign-in are included in every Entra ID tier, the free one included. (Optional
hardening such as Conditional Access requires P1/P2 licences, but nothing here depends on it.)

## Scripted path

```bash
pwsh docs/index/setup-entra-id.ps1 -PlayUrl https://play.example.com -AdminApiUrl https://admin.example.com
```

Idempotent: it finds the registration by display name and completes whatever is missing. It prints the exact
`OPENID_*` block for `.env` — the client secret **once**, saved nowhere. Exit codes: 0 success, 1 wrong parameters,
2 environment not ready, 3 Entra answered an error.

## Manual path

Every step in plain CLI, for auditability. Values in `<>` are yours.

```bash
# 1. The registration, with all three callbacks. Byte for byte: a URI that differs by one character fails AADSTS50011.
az ad app create --display-name "VirtualOffice" \
  --sign-in-audience AzureADMyOrg \
  --web-redirect-uris \
    "https://<play-host>/openid-callback" \
    "https://<play-host>/logout-callback" \
    "https://<admin-host>/admin/callback"

# 2. Ask for the email claim in the ID token (Entra only emits what is asked for).
#    Portal alternative: App registrations > Token configuration > Add optional claim > ID > email.
az ad app update --id <appId> --optional-claims '{
  "idToken": [
    { "name": "email", "essential": false },
    { "name": "preferred_username", "essential": false }
  ]
}'

# 3. A client secret. Printed once; put it in the secret store, never in a committed file.
az ad app credential reset --id <appId> --append \
  --display-name "virtualoffice-$(date +%Y%m%d)" --end-date "$(date -u -d '+3 months' +%Y-%m-%dT%H:%M:%SZ)"
```

Then fill the repository-root `.env` (the same block the script prints):

```dotenv
OPENID_CLIENT_ID=<Application (client) ID>
OPENID_CLIENT_SECRET=<the secret>
OPENID_CLIENT_ISSUER=https://login.microsoftonline.com/<tenant id>/v2.0
OPENID_SCOPE=openid profile email
OPENID_USERNAME_CLAIM=preferred_username
```

and recreate the stack: `docker compose up -d`. Leaving the block empty returns to the mock — that is the whole
rollback.

Three values worth understanding rather than copying:

- **`OPENID_SCOPE` must not contain `tags-scope`.** That scope exists only on the mock; Entra rejects unknown scopes
  with `AADSTS70011`. Dropping it loses nothing — authorisation comes from the database (F3).
- **`OPENID_USERNAME_CLAIM=preferred_username`** is what makes `OPID_WOKA_NAME_POLICY=allow_override_opid` (staged
  since ADR-0003) finally take effect: the world proposes the Microsoft name and the person may change it.
- **The issuer must end in `/v2.0`** — without it, discovery finds the v1 endpoint and every token validation fails.

## Verification

The staging checklist the roadmap calls F2/P0. In order, because each step exercises the previous one:

1. `docker compose logs play | grep -i "capabilities"` — the pusher still reaches `admin-api` (nothing about F2
   should have touched it; this catches an accidentally emptied `.env`).
2. Open the world in a private window → the Microsoft sign-in appears → after signing in you are in the map.
3. The proposed display name is your Microsoft name, and you can change it (`allow_override_opid`).
4. `docker compose exec admin-api npm run member:list` — your **email** appeared as a member row on first login.
5. Grant yourself a tag and see it act: `member:grant -- <your email> editor`, reload, the map editor is available.
6. Open `https://<admin-host>/admin` → the same Microsoft sign-in → the dashboard, provided your member row holds
   the `admin` tag (grant it with direct SQL — `docs/SETUP-ADMIN-API.md`, "Granting admin").
7. Sign out from the world → the browser lands back on `<play>/logout-callback` without an Entra error page.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `AADSTS50011` (redirect URI mismatch) | The callback is not registered **exactly**. Compare scheme, host, port and path against the three URIs above. |
| `AADSTS70011` (invalid scope) | `tags-scope` (or a typo) is still in `OPENID_SCOPE`. Use `openid profile email`. |
| `AADSTS7000215` (invalid client secret) | The secret expired or was pasted with a trailing space. Re-run the script; it always mints a fresh one. |
| Login works but the dashboard answers "no email claim" | The optional claim is missing (step 2 of the manual path), or the account genuinely has no mail address. The dashboard refuses rather than guessing (`OpenIdConnectAuthenticator`). |
| The world proposes no name | `OPENID_USERNAME_CLAIM` unset or not `preferred_username`. |
| Everyone lost map-editor access after the switch | Expected: identities are now emails from Entra. Grant tags to the real addresses — `docs/SETUP-ADMIN-API.md`. The bootstrap admin (`ADMIN_API_BOOTSTRAP_ADMIN_EMAIL`) must be set to a real address too. |

## Credential rotation

Every 90 days (the default secret lifetime matches): re-run the script — it appends a new secret without touching
the old one — update `.env`/the vault, `docker compose up -d`, then delete the old secret in the portal once the new
one is proven. Ad hoc on suspicion of compromise, same steps.

## Decommissioning

Empty the `OPENID_*` block in `.env` and recreate the stack (back to the mock), then delete the app registration:
`az ad app delete --id <appId>`. Member rows, tags, bans and audit entries all survive — they belong to `admin-api`,
not to the provider.

## What stays open

- **Retiring the mock (spec F2/P2) is deliberately not done here.** Without the mock there is no offline local
  login, so that step waits until a development tenant (or permanent-mock decision) exists — the spec flags this
  risk explicitly.
- Nothing verifies these steps against a live tenant from CI; the Verification section is a human checklist.

## References

- [Roadmap spec, Feature 2](specs/0001-feature-roadmap.md) — the config-swap decision and its history
- [SETUP-ADMIN-API.md](SETUP-ADMIN-API.md) — granting tags and `admin`, bootstrap, rollback
- [ADR-0003](adr/0003-member-and-tag-management.md) — decision #4, the woka-name policy this switch activates
- [Threat model](security/threat-model.md) — F7, the session secret that must not stay a dev default

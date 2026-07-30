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

## Areas

- `src/api/`: Express controllers and the server factory.
- `src/Enum/`: environment variables, validated with `zod` at startup.

## Common commands

```bash
cd admin-api

npm run typecheck
npm run lint
npm run pretty-check
npm test
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

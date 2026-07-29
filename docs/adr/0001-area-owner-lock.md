# ADR-0001: Persistent owner-controlled area lock, with a red tint

- **Status:** Proposed
- **Date:** 2026-07-23
- **Deciders:** VirtualOffice team
- **Languages:** [0001-area-owner-lock.pt-BR.md](0001-area-owner-lock.pt-BR.md) (pt-BR) + this file (en-US), in lockstep.
- **Source spec:** [Spec 0001 — Feature Roadmap](../specs/0001-feature-roadmap.md), Feature 4.

## Context

In VirtualOffice, each user owns an **area** inside a **single shared map** — their virtual office. The goal is to let the owner **close and reopen** their area at will, with a **persistent** lock, and to give that lock a **visual representation** — a semi-transparent red tint over the area while it is locked.

> ⚠️ Premise corrected during design: a "room" here is an **area inside a map**, not its own map/URL. This ruled out `RoomRedirect` (which changes map) and the `/api/room/access` gate (which is map-level).

### What already exists (verified in code)

| Primitive | Where | Current behavior |
|---|---|---|
| **Personal area** | `personalAreaPropertyData` in [`libs/map-editor/src/types.ts`](../../libs/map-editor/src/types.ts) | Has `ownerId` and `accessClaimMode` (`dynamic` = claim by walking with the tag; `static` = assigned owner). The docs describe it as *"the user's virtual office space"*. **Ownership already exists and already persists.** |
| **Lockable area** | `lockableAreaPropertyData` | Lock/unlock; entry blocked by **collision** at the boundary. |
| **Lock state** | Area property variable, key `"lock"` (boolean) | Written by `setAreaPropertyLockState(areaId, propertyId, locked)` ([`AreaPropertyVariablesStore.ts`](../../play/src/front/Stores/AreaPropertyVariablesStore.ts)); read by `AreasManager.isAreaLocked()`, which triggers `updateAreaCollision()` ([`AreasManager.ts`](../../play/src/front/Phaser/Game/GameMap/AreasManager.ts)). Server-synced to all clients. |
| **Auto-unlock** | **In the `back`**, on the user-leave event | Comments in `AreasManager.ts:262` and `AreasPropertiesListener.ts:353`: *"unlock when empty is handled by the back on user leave"*. **This is where the ephemeral semantics live.** |
| **Avatar repositioning** | `CurrentPlayer.teleportTo(x, y)` ([`GameScene.ts:3566`](../../play/src/front/Phaser/Game/GameScene.ts)) | Already used by `WA.player.teleport`. Moves the avatar **within the same map**. |
| **Area coordinates** | `AreaData` = `{x, y, width, height}` | In **pixels**. Tile conversion: `area.x / tilewidth`, with `tilewidth ?? 32` ([`GameMapFrontWrapper.ts:543`](../../play/src/front/Phaser/Game/GameMap/GameMapFrontWrapper.ts)). |

**Context conclusion:** we need to build neither the lock, nor ownership, nor persistence. It all exists. What is missing is **switching the semantics** (ephemeral→persistent, anyone→owner-only) and **drawing the walls**.

## Decision

### 1. Extend `lockableAreaPropertyData` (do not create a new property)

Add a **mode**, keeping the default on current behavior:

```ts
export const LockableAreaPropertyData = PropertyBase.extend({
    type: z.literal("lockableAreaPropertyData"),
    allowedTags: z.array(z.string()).optional(),
    // NEW:
    lockMode: z.enum(["ephemeral", "owner"]).default("ephemeral"),
    doorGapTiles: z.number().min(1).default(2),  // width of the south opening, in tiles
    gracePeriodSeconds: z.number().min(0).max(300).default(300),
});
```

The `default("ephemeral")` is the crux: **existing maps keep working with no migration**, because zod fills in the current mode. No ephemeral lock in use changes behavior.

**No configurable `DoorData`:** the opening is **always south, centered** (see decision #3). Only its width (`doorGapTiles`) is tunable, defaulting to 2 tiles.

### 2. Ownership comes from the area (standalone, no `admin-api`)

With `lockMode: "owner"`, the owner is the `ownerId` of the `personalAreaPropertyData` **on the same area**. This makes F4 **independent of F3**.

**Validation rule:** `lockMode: "owner"` requires the area to also carry `personalAreaPropertyData`. Without it the configuration is invalid — the editor must prevent it, and the runtime must degrade to `ephemeral` rather than break.

### 3. Visual signalling: persistent red tint while locked (revised 2026-07-24)

**Scope revision (2026-07-24):** the earlier designs — a door asset, then **procedural walls with a south opening** — were **dropped** after runtime testing. Reason: the user saw that (a) a locked area already reacts visually on contact (it flashes red, via `flashBlockedArea`) and (b) **nobody gets trapped** — those inside simply walk out. Walls and an "exit door" were needless complexity.

**Decision:** while the area is locked, apply a **persistent, semi-transparent red tint** over the area — the same colour as the collision flash (`0xff6b6b` at `0.25`), but **without the fade**, for as long as the lock lasts. It is the "this area is closed" affordance, visible to **everyone**, including those inside.

Implementation: `Area.setLockedHighlight(locked)` ([Area.ts](../../play/src/front/Phaser/Entity/Area.ts)) sets/clears the tint; driven by [`AreasManager.updateAreaCollision`](../../play/src/front/Phaser/Game/GameMap/AreasManager.ts), which already watches the `"lock"` variable and runs on every state change. **No walls, no new Phaser Graphics, no exit-coordinate computation.**

#### Enforcement is still the existing collision

Access collision **does not change**: it is **binary per client** — those **outside** get collision (cannot enter); those **inside get none** and walk out freely (`AreasManager` lines 275-278: *"Users already inside can still exit"*). The tint is purely **visual**; it does not alter access.

#### Scope of the tint

It applies to **any** locked area (owner **and** ephemeral). For ephemeral locks (meeting rooms) the area also turns red while locked — a nicer affordance, but a visual change to an existing feature. Restricting it to `lockMode: "owner"` is a one-liner if the ephemeral lock's look should stay untouched.

### 4. Persistence: the `back` does not auto-unlock in `owner` mode

The behavioral change is **one point in the `back`**: on the user-leave event, auto-unlock becomes conditional — it only happens when `lockMode === "ephemeral"`. In `owner` mode, the `"lock"` variable stays as-is until **the owner** changes it.

### 5. Who may lock

- `ephemeral` mode: current behavior (anyone inside, optionally gated by `allowedTags`). **Unchanged.**
- `owner` mode: **the owner only**. The lock button is disabled for everyone else.

### 6. Behavior while the area is closed (non-owners)

**Scope revision (2026-07-24):** the **"Leave area"** button, the **reconnection grace period** and the **teleport** (`RoomRedirect`/repositioning) were **removed**. Reason: the user **is not trapped** — collision only blocks *entry*; those inside walk out normally. Assisted exit was unnecessary.

| Situation | Behavior |
|---|---|
| Inside and wants to leave | Walks out — collision blocks entry only, not exit (current behavior) |
| Never was inside | Blocked at the boundary by collision (current behavior) |
| Reconnection | Treated as any entry: if still locked and not the owner, blocked at the boundary — **no grace** |
| Administrator | **No exception** — does not bypass the lock |

Consequence: the schema fields `doorGapTiles` and `gracePeriodSeconds` (added in P0 for the abandoned designs) are now **reserved/unused**. They stay in the schema (defaulted, harmless) and may be dropped in a future refactor if confirmed unnecessary. Only `lockMode` has an effect.

### 7. Closing ≠ emptying

Closing the area is an **entry gate**: it blocks new entrants, it evicts nobody. Those inside remain until they leave of their own accord (or via the button).

## Alternatives considered

### A. Create a new property (`ownerLockableAreaPropertyData`)
- **Pros:** total isolation; zero risk to the ephemeral lock.
- **Cons:** duplicates the "lockable area" concept; two lock systems to maintain, two editors, two screens; users would have to understand the difference.
- **Rejected:** `lockMode` with a default preserves old behavior with far less duplication.

### B. Ownership from `admin-api` (F3)
- **Pros:** centralized, audited management; assign/revoke areas from the dashboard.
- **Cons:** creates a hard dependency on F3, the largest feature in the roadmap — it would delay F4 by weeks.
- **Deferred, not rejected:** the personal area already persists `ownerId`. The dashboard can manage ownership later, as an evolution, without blocking now.

### C. `RoomRedirect` for "teleporting out"
- **Rejected:** `RoomRedirect` moves the user to a different **map/URL**. Here they must stay in the same map. Wrong layer.

### D. Free-form exit coordinate (no door)
- **Pros:** simpler to implement.
- **Cons:** no visual affordance — the user cannot see that the area is closed, nor where one enters/leaves.
- **Rejected:** walls with a south opening solve UX and exit determinism in one move.

### E. Door as a configurable art asset (4 walls, free position)
- **Pros:** flexible; door on any wall.
- **Cons:** requires producing art (open/closed) — an external dependency; and perimeter-minus-gap collision, expensive.
- **Rejected (user decision):** procedural walls with a fixed south opening deliver the same visual value with no art and without touching the collision model.

## Consequences

### Positive
- **Cheap:** reuses existing ownership, lock, persistence and repositioning. Effort **S**.
- **Backward compatible:** `lockMode` defaults to `"ephemeral"` → current maps untouched, no migration.
- **Unblocks the roadmap:** F4 stops depending on F3 and can ship first — delivering visible value early, which was the weak point of the previous order.
- **Clear affordance:** the door communicates state with no extra UI.
- **Escape hatch for permanent lockout already exists:** the personal area supports *"revoke access"* from the editor, with no need for F3.

### Negative
- **Two semantics in one property:** the editor must make the active mode obvious, or it will confuse.
- **Touches the `back`:** auto-unlock becomes conditional; this is the highest regression risk.
- **Permanent lockout is real:** with no admin override, a vanished owner means a closed area. Mitigated by the personal area's *revoke*, but it requires manual action.
- **New procedural drawing:** the walls need render code (Phaser Graphics), though cheap and art-free.

### Neutral
- Grace tracking lives in the `back` (not the front, not `admin-api`).
- **No art dependency** — resolved by the procedural-walls decision.
- Walls are purely visual; enforcement is the existing binary collision.

## Implementation plan

| Phase | Scope | Status |
|---|---|---|
| **P0** | Schema: `lockMode` (+ `doorGapTiles`/`gracePeriodSeconds`, now reserved) + validation (owner requires a personal area). | ✅ done |
| **P1** | `back`: auto-unlock conditional on `lockMode`. Ephemeral-mode regression test first. | ✅ done |
| **P2** | Front + back: restrict locking to the owner in `owner` mode (pure `canToggleAreaLock`, enforced on both sides). | ✅ done |
| **P3** | Front: **persistent red tint** while locked (`Area.setLockedHighlight`, driven by `AreasManager`). | ✅ done |
| ~~P4~~ | ~~Grace period + leave button + teleport~~ — **removed** (user is not trapped; walks out). | ❌ cut |
| **P5** | Bilingual docs (user and developer). | pending |

### Mandatory regression tests

1. **Ephemeral mode unchanged** — lock, empty out, auto-unlocks. *(Most important: it is the feature in production.)* ✅
2. `owner` mode: does **not** unlock when empty. ✅
3. Only the owner locks/unlocks; button disabled for everyone else. ✅
4. `lockMode: "owner"` without a personal area → degrades to `ephemeral`, does not break. ✅
5. New entrant blocked while closed; those inside walk out (collision blocks entry only). *(existing behavior)*
6. The red tint appears on lock and clears on unlock. *(Phaser visual — manual in-app check; hard to unit test)*

> Reconnection / grace / teleport / door items were **removed** with the P3/P4 scope cut.

## Points confirmed

1. ✅ **No art, no walls** — reuses the collision-flash red, made persistent.
2. ✅ **Rectangular areas only** — no composite-area case for personal rooms.
3. ✅ **Nobody is trapped** — collision blocks entry only; leaving is walking out.

No pending point blocks implementation.

## References

- [Spec 0001 — Feature Roadmap](../specs/0001-feature-roadmap.md) (Feature 4)
- [`libs/map-editor/src/types.ts`](../../libs/map-editor/src/types.ts) — `LockableAreaPropertyData`, `PersonalAreaPropertyData`, `AreaData`
- [`play/src/front/Phaser/Game/GameMap/AreasManager.ts`](../../play/src/front/Phaser/Game/GameMap/AreasManager.ts) — `isAreaLocked`, collision
- [`play/src/front/Stores/AreaPropertyVariablesStore.ts`](../../play/src/front/Stores/AreaPropertyVariablesStore.ts) — `setAreaPropertyLockState`
- [Personal area doc](../map-building/inline-editor/area-editor/personal-area.md)
- [Lockable area doc](../map-building/inline-editor/area-editor/lockable-area.md)

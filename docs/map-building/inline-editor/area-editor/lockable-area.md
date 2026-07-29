---

sidebar_position: 75

---

# Lockable area

## Description

A lockable area is a zone that users inside it can temporarily lock, preventing anyone outside from entering. When locked, the area acts as a collision zone and players trying to enter it will hit an invisible wall. This is useful for creating spaces like private meeting rooms or breakout zones that a group can claim temporarily.

If a user leaves a locked area, they cannot re-enter until the area is unlocked by one of the users inside the area.

The lock is **ephemeral**. When all users leave a locked area, it is automatically unlocked.

## Create a lockable area

While editing an area, select the lockable area option.

![](../../images/editor/lockable-area/lockable-area-1.png)

You can optionally define which user tags are allowed to lock and unlock the area. If no tags are specified, any user inside the area can lock or unlock it.

![](../../images/editor/lockable-area/lockable-area-2.png)

## Locking and unlocking

When a user enters a lockable area, a lock button appears in the action bar at the top of the screen.

Clicking the lock button locks the area. The area briefly flashes red to give visual feedback to all users.

![](../../images/editor/lockable-area/lockable-area-3.png)

Clicking the button again unlocks the area, allowing others to enter freely.

If the user does not have the required tags to lock or unlock the area, the lock button is displayed but disabled.

## Blocked users

When a user outside the area tries to enter a locked area, their movement is blocked at the area boundary. A message is displayed: **"This area is locked. You cannot enter."**

:::info
Users with the `admin` tag can force-unlock a locked area. When an admin tries to enter a locked area, a prompt is displayed allowing them to press the space key to unlock the area.
This is useful for cases where a user locks an area and forgets to lock the area before walking away from their computer.
This admin shortcut does **not** apply to areas in owner mode (see below): an owner lock is sovereign.
:::

## Auto-unlock

When the last user leaves a locked area, the area is automatically unlocked. This means a lockable area never stays locked permanently with no one inside.

Areas in **owner mode** (below) are the exception: they stay locked until the owner unlocks them.

## Owner mode (persistent lock)

Owner mode turns a lockable area into a private room controlled by a single user — typically their personal office inside a shared map.

To enable it, the area needs **two properties**:

1. A **personal area** property, with a claimed owner (either assigned statically, or claimed by walking in with dynamic claim mode).
2. The **lockable area** property, with the **"Owner mode (persistent lock)"** switch turned on in the map editor. While owner mode is on, the allowed-tags field is hidden — tags do not apply; only the owner may lock.

While owner mode is active:

- **Only the owner** can lock or unlock the area. The lock button is disabled for everyone else.
- The lock **persists when the area empties** — no auto-unlock. The owner can lock their office and leave.
- **The owner passes through their own lock**: they can leave and re-enter freely without unlocking, while everyone else stays blocked at the boundary.
- The area shows a **persistent red tint** while locked, so everyone can see at a glance that it is closed.
- **Admins cannot bypass** the lock: the space-key force-unlock is not offered on owner-locked areas.
- **Voice bubbles do not cross the boundary**: someone standing just outside a locked area cannot start a proximity voice chat with someone inside. Users on the same side keep chatting normally.

:::caution
If the personal area has no claimed owner (for example, the owner was revoked), owner mode degrades to the regular ephemeral behaviour: anyone allowed by the tags can lock, and the area auto-unlocks when it empties. This guarantees an area can never stay locked forever with nobody able to open it.
:::

:::note
If a voice bubble already spans the boundary at the moment the area is locked, it is not broken up; it dissolves naturally when the participants move apart. The lock prevents **new** bubbles from forming across the boundary.
:::

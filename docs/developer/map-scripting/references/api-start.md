---
sidebar_position: 1
---

# Start

### Waiting for ArqueumSpace API to be available

When your script / iFrame loads ArqueumSpace, it takes a few milliseconds for your script / iFrame to exchange
data with ArqueumSpace. You should wait for the ArqueumSpace API to be fully ready using the `WA.onInit()` method.

```
WA.onInit(): Promise<void>
```

Some properties (like the current user name, or the room ID) are not available until `WA.onInit` has completed.

Example:

```typescript
WA.onInit().then(() => {
    console.log('Current player name: ', WA.player.name);
});
```

Or the same code, using await/async:

```typescript
(async () => {
    await WA.onInit();
    console.log('Current player name: ', WA.player.name);
})();
```

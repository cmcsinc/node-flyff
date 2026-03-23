# Performance Rules

The 50ms game tick is sacred. These rules prevent event loop blocking, GC pressure, and memory leaks.

## The Game Tick Contract

The world server runs a 50ms `setInterval` tick. The entire tick — across all managers and systems — must complete in **under 10ms**. Anything slower blocks the event loop and lags all connected players.

### Inside the Tick — Forbidden

```ts
// FORBIDDEN inside worldTick():
await db.query(...)             // no async DB calls
await someHttpRequest()         // no network calls
fs.readFileSync(...)            // no sync I/O
JSON.parse(largeFile)           // no heavy CPU work
new Buffer(size)                // no large allocations
```

### CPU-Heavy Work → Worker Threads

Anything that takes > 1ms per call must run in a Worker Thread:
- Pathfinding
- Collision detection for large zones
- Large JSON serialization (e.g., map data)

## Object Pooling

Frequently allocated short-lived objects must use a pool to reduce GC pressure:

```ts
// Packet pool — reuse PacketWriter instances
const packetPool = new ObjectPool(() => new PacketWriter(), 64);
const writer = packetPool.acquire();
// ... use writer ...
packetPool.release(writer);
```

Apply pooling to: `PacketWriter`, `PacketReader`, position vectors `{ x, y, z }`.

## Zone-Based Broadcasting

**Never** iterate all connected players to broadcast. Always iterate players in the same zone:

```ts
// FORBIDDEN ❌ — O(n) across all players
for (const player of allPlayers.values()) {
  player.socket.write(packet);
}

// REQUIRED ✅ — O(k) where k = players in zone
zone.broadcastAround(position, VISIBILITY_RADIUS, packet);
```

## Memory Management

- **Never store strong references** to `CPlayer` objects inside `setInterval` or `setTimeout` callbacks — they will prevent GC after disconnect.
- **Use WeakRef** if you need to hold a soft reference to a game object from a timer.
- **Clear timers on cleanup.** Every `setInterval`/`setTimeout` stored on a player or zone must be `clearInterval`/`clearTimeout`'d when the player disconnects or the zone is destroyed.
- **Map cleanup.** Always call `manager.remove(id)` on disconnect — never rely on GC to clean Maps.

## Buffer & Packet Rules

- `PacketWriter` instances must be reset and returned to the pool after use — not garbage collected.
- Prefer `Buffer.allocUnsafe()` + manual fill over `Buffer.alloc()` for hot paths (packet building).
- **Never keep a reference** to the raw incoming `chunk` Buffer after parsing — copy needed data out.

## Async Rules

- **No `await` inside `setInterval` tick.** If an async action is needed (e.g., save to DB), push to a queue and drain outside the tick.
- **No unbounded queues.** Cap async work queues at a reasonable max (e.g., 1000 events). Drop with a `warn` log if exceeded.
- **All Promises must settle.** Every `.then()` must have a `.catch()`. Every `async` function call must be `await`ed or have its rejection handled.

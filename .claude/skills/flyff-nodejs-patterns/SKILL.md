---
name: flyff-nodejs-patterns
description: >
  Node.js-specific patterns, async/await, EventEmitter, streams, Worker Threads, TCP socket
  management, memory management, and performance patterns for the Flyff server emulator.
  Use this skill whenever the user asks about async code, event-driven architecture, how to
  handle TCP data, worker threads for heavy computation, timers, memory leaks, garbage
  collection pressure, object pooling, circular references, Buffer usage, stream pipelines,
  or any Node.js runtime concern. Trigger on: "async", "await", "Promise", "EventEmitter",
  "net.Socket", "Worker", "setInterval", "Buffer", "stream", "memory", "performance",
  "tick loop", "event loop blocking", "GC pressure", "object pool".
---

# Flyff Emulator — Node.js Patterns

## TCP Socket Management

### Connection Lifecycle

```js
// world-server/src/net/socketServer.js
import net from 'net';
import { PacketBuffer } from '@flyff/core';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { dispatch } from './dispatcher.js';
import { logger } from '@flyff/core/logger.js';

export function createSocketServer(port, onReady) {
  const server = net.createServer(socket => {
    // Attach session state to socket
    socket.session = {
      state:  SessionState.CONNECTED,
      charId: null,
      cipher: null,
      pktBuf: new PacketBuffer(),
    };

    socket.setNoDelay(true);        // disable Nagle — low latency > throughput
    socket.setKeepAlive(true, 15000); // detect dead connections

    socket.on('data',  chunk => onData(socket, chunk));
    socket.on('close', ()    => onClose(socket));
    socket.on('error', err   => onError(socket, err));
  });

  server.listen(port, () => {
    logger.info({ port }, 'Server listening');
    onReady?.();
  });

  return server;
}

function onData(socket, chunk) {
  // Decrypt if cipher is active
  if (socket.session.cipher) {
    socket.session.cipher.transform(chunk);
  }

  socket.session.pktBuf.push(chunk);

  for (const pkt of socket.session.pktBuf.drain()) {
    try {
      dispatch(socket, pkt);
    } catch (err) {
      logger.warn({ err }, 'Packet dispatch error — dropping connection');
      socket.destroy();
      return;
    }
  }
}

function onClose(socket) {
  logger.info({ charId: socket.session?.charId }, 'Socket closed');
  // cleanup handled by PlayerManager
  socket.session = null;
}

function onError(socket, err) {
  if (err.code !== 'ECONNRESET' && err.code !== 'EPIPE') {
    logger.warn({ err }, 'Socket error');
  }
  socket.destroy();
}
```

---

## Async Patterns

### Safe async handler wrapper

Never let an async handler throw unhandled — wrap all handlers:

```js
/**
 * Wraps an async packet handler to catch and log errors without crashing.
 * @param {Function} fn - async (socket, reader) => void
 * @returns {Function}
 */
export function asyncHandler(fn) {
  return (socket, reader) => {
    Promise.resolve(fn(socket, reader)).catch(err => {
      logger.error({ err, charId: socket.session?.charId }, 'Handler error');
      socket.destroy();
    });
  };
}

// Usage
handlers.set(SNSP_LOGIN_CERTIFY, asyncHandler(handleLoginCertify));
```

### Sequential async init (startup)

```js
// index.js — startup sequence matters
async function bootstrap() {
  await loadResources('./resources/data');    // must be first
  await db.connect();                         // need resources to validate
  await redis.connect();
  createSocketServer(parseInt(process.env.PORT));
  logger.info('World server ready');
}

bootstrap().catch(err => {
  logger.fatal({ err }, 'Startup failed');
  process.exit(1);
});
```

---

## Game Loop — Non-blocking Tick

Never `await` inside the tick — it blocks subsequent ticks. Use a task queue instead:

```js
// systems/gameLoop.js
const taskQueue = [];
let last = process.hrtime.bigint();

function tick() {
  const now = process.hrtime.bigint();
  const dt  = Number(now - last) / 1e6; // ms elapsed
  last = now;

  // Drain the async task queue (results from previous async work)
  let task;
  while ((task = taskQueue.shift())) task();

  // Synchronous tick work only
  zoneManager.tick(dt);
  spawnManager.tick(dt);
  aiScheduler.tick(dt);
}

setInterval(tick, 50); // 20 ticks/sec

// Enqueue async work results
export function scheduleOnTick(fn) {
  taskQueue.push(fn);
}
```

---

## Worker Threads (Heavy Computation)

Use Worker Threads for pathfinding, collision checks, or map loading — never block the event loop:

```js
// workers/pathfinder.worker.js (runs in separate thread)
import { parentPort, workerData } from 'worker_threads';
import { findPath } from '../systems/pathfinding.js';

parentPort.on('message', ({ requestId, from, to, zoneId }) => {
  const path = findPath(from, to, zoneId);
  parentPort.postMessage({ requestId, path });
});
```

```js
// systems/pathfinderPool.js (main thread)
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';

const POOL_SIZE = 2;
const pool = Array.from({ length: POOL_SIZE }, () =>
  new Worker(fileURLToPath(new URL('./pathfinder.worker.js', import.meta.url)))
);

let poolIdx = 0;
const pending = new Map(); // requestId → { resolve, reject }
let reqId = 0;

pool.forEach(w => {
  w.on('message', ({ requestId, path }) => {
    pending.get(requestId)?.resolve(path);
    pending.delete(requestId);
  });
});

export function requestPath(from, to, zoneId) {
  return new Promise((resolve, reject) => {
    const id = reqId++;
    pending.set(id, { resolve, reject });
    pool[poolIdx++ % POOL_SIZE].postMessage({ requestId: id, from, to, zoneId });
  });
}
```

---

## EventEmitter — Game Events

Use EventEmitter for decoupled system communication within a server process:

```js
// core/eventBus.js
import { EventEmitter } from 'events';
export const bus = new EventEmitter();
bus.setMaxListeners(100); // avoid spurious warnings

// Event name constants
export const EV = Object.freeze({
  PLAYER_ENTER:    'player:enter',
  PLAYER_LEAVE:    'player:leave',
  PLAYER_LEVEL_UP: 'player:levelUp',
  MONSTER_KILLED:  'monster:killed',
  ITEM_DROPPED:    'item:dropped',
});
```

```js
// Emitting
bus.emit(EV.PLAYER_LEVEL_UP, { player, newLevel: player.m_nLevel });

// Subscribing (in combat.system.js)
bus.on(EV.MONSTER_KILLED, ({ monster, killer }) => {
  rewardExp(killer, monster);
  rollDrops(monster, killer);
});
```

---

## Object Pooling (Reduce GC Pressure)

Packet builders are created thousands of times per second — pool them:

```js
// core/net/packetPool.js
const FREE = [];

export function acquireWriter(opcode) {
  const w = FREE.pop() ?? new PacketWriter();
  w.reset(opcode);
  return w;
}

export function releaseWriter(w) {
  w.reset(0);
  FREE.push(w);
}

// In PacketWriter
reset(opcode) {
  this.opcode = opcode;
  this.chunks.length = 0; // reuse array, avoid GC
  return this;
}
```

---

## Buffer Best Practices

```js
// GOOD — allocate exact size, use subarray views
const frame = Buffer.allocUnsafe(4 + 2 + 2 + payloadLen); // faster than alloc(0)

// GOOD — avoid unnecessary copies: slice is a view
const payload = rawPacket.subarray(4); // zero-copy view

// BAD — repeated concat in a loop creates GC pressure
let buf = Buffer.alloc(0);
for (const chunk of chunks) buf = Buffer.concat([buf, chunk]); // ❌

// GOOD — collect then concat once
const buf = Buffer.concat(chunks); // ✅

// Pre-allocate reusable scratch buffers for hot paths
const SCRATCH = Buffer.allocUnsafe(512);
```

---

## Graceful Shutdown

```js
// Handle SIGTERM (Docker stop, k8s) and SIGINT (Ctrl+C)
async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down...');

  // 1. Stop accepting new connections
  server.close();

  // 2. Save all online players and clear their WAL journals
  const syncTime = Date.now();
  await Promise.allSettled(
    playerManager.all().map(async p => {
      await characterRepo.save(p);
      clearJournal(p.m_dwCharId, syncTime);
    })
  );

  // 3. Close DB and Redis
  await db.end();
  await redis.quit();

  logger.info('Clean shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// Catch unhandled rejections — log but don't crash
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled rejection');
});
```

---

## Timer Utilities

```js
// utils/time.js

/** High-resolution timestamp in milliseconds (float) */
export const hrNow = () => Number(process.hrtime.bigint()) / 1e6;

/** Flyff-compatible GetTickCount() — uint32 ms since process start */
export const GetTickCount = () => (performance.now() | 0) >>> 0;

/** Sleep for N ms (use only outside game tick) */
export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Debounce: run fn at most once per `wait` ms */
export function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
```

---

## Memory Leak Checklist

Common leaks in a game server context:

| Source | Fix |
|---|---|
| Event listeners not removed on disconnect | Call `socket.removeAllListeners()` in `onClose` |
| Timers not cleared when entity despawns | Store timer IDs on the object; `clearInterval` in destroy() |
| Map/Set entries never deleted | Remove from `objectMap`, `playerMap` on despawn |
| Closure capturing large objects | Be explicit — don't close over entire `zone` when you only need `zone.id` |
| Stale references in the pending request Map (worker threads) | Add timeout cleanup: `setTimeout(() => pending.delete(id), 5000)` |

---

## Env Config

```js
// config.js — never hard-code values
export const config = {
  port:        parseInt(process.env.PORT   ?? '23000'),
  dbUrl:       process.env.DATABASE_URL    ?? 'postgresql://flyff:flyff@localhost/flyff',
  redisUrl:    process.env.REDIS_URL       ?? 'redis://localhost:6379',
  logLevel:    process.env.LOG_LEVEL       ?? 'info',
  tickRate:    parseInt(process.env.TICK_RATE ?? '50'),
  maxPlayers:  parseInt(process.env.MAX_PLAYERS ?? '500'),
};
```

Use a `.env` file locally (via `dotenv`) and real environment variables in production.

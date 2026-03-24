---
name: flyff-cache-layer
description: >
  ICacheAdapter interface, RedisCache, CloudflareCache, and MemoryCache implementations
  for the Flyff TypeScript emulator. Use this skill when working with caching, session
  tokens, server state broadcasting, or implementing any cache-backed lookup. Trigger on:
  "cache", "ICacheAdapter", "RedisCache", "MemoryCache", "CloudflareCache", "TTL", "token cache",
  "session cache", "ioredis", "KV store".
---

# flyff-cache-layer

## 1. ICacheAdapter Interface

All cache access goes through this interface. Never import Redis or Cloudflare KV directly in services — always depend on `ICacheAdapter`.

```ts
// packages/core/src/cache/ICacheAdapter.ts
export interface ICacheAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  publish?(channel: string, message: string): Promise<void>;
  subscribe?(channel: string, fn: (msg: string) => void): Promise<void>;
}
```

`publish` and `subscribe` are optional — only `RedisCache` implements them. Check before calling:

```ts
if (cache.publish) {
  await cache.publish('server:status', JSON.stringify(payload));
}
```

---

## 2. MemoryCache (Testing / Dev)

Used in unit tests and single-process dev mode. Not suitable for multi-process deployments.

```ts
// packages/core/src/cache/MemoryCache.ts
export class MemoryCache implements ICacheAdapter {
  private readonly store = new Map<string, string>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.store.set(key, value);
    if (ttlSeconds !== undefined) {
      const existing = this.timers.get(key);
      if (existing !== undefined) clearTimeout(existing);
      const timer = setTimeout(() => {
        this.store.delete(key);
        this.timers.delete(key);
      }, ttlSeconds * 1000);
      timer.unref();
      this.timers.set(key, timer);
    }
  }

  async del(key: string): Promise<void> {
    const timer = this.timers.get(key);
    if (timer !== undefined) clearTimeout(timer);
    this.store.delete(key);
    this.timers.delete(key);
  }
}
```

---

## 3. RedisCache (Production)

Uses `ioredis`. Supports pub/sub for cross-process messaging. TTL uses `PX` (milliseconds) internally.

```ts
// packages/core/src/cache/RedisCache.ts
import Redis from 'ioredis';

export class RedisCache implements ICacheAdapter {
  private readonly client: Redis;
  private readonly sub: Redis;

  constructor(redisUrl: string) {
    this.client = new Redis(redisUrl);
    this.sub = new Redis(redisUrl);
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds !== undefined) {
      await this.client.set(key, value, 'PX', ttlSeconds * 1000);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.client.publish(channel, message);
  }

  async subscribe(channel: string, fn: (msg: string) => void): Promise<void> {
    await this.sub.subscribe(channel);
    this.sub.on('message', (ch, msg) => {
      if (ch === channel) fn(msg);
    });
  }
}
```

---

## 4. Wiring via compose.ts

Select the cache implementation in each server's composition root. Never construct Redis directly in a service.

```ts
// packages/login-server/src/compose.ts
import { RedisCache } from '@flyff/core/cache/RedisCache.js';
import { MemoryCache } from '@flyff/core/cache/MemoryCache.js';
import { config } from '@flyff/core/config.js';

const cache = config.REDIS_URL
  ? new RedisCache(config.REDIS_URL)
  : new MemoryCache();

// Inject into services
const tokenService = TokenService.init({ cache });
const authService  = AuthService.init({ cache, accountRepo });
```

Services receive `ICacheAdapter` in their `init()` deps — never `RedisCache` or `MemoryCache` directly.

---

## 5. Cache Key Naming Conventions

| Key pattern      | TTL      | Value                         | Used by              |
|------------------|----------|-------------------------------|----------------------|
| `token:{token}`  | 30s      | JSON-serialized session data  | Login → Cluster handoff |
| `session:{id}`   | 5min     | JSON-serialized player state  | Cluster → World handoff |
| `server:list`    | 10s      | JSON array of world servers   | Server list handler  |

Always use the exact key prefix above. Derivations must be documented here.

---

## 6. When NOT to Cache

Never cache mutable, per-tick game state:

- HP / MP / FP values — update every hit; cache lag causes stat desync
- Player position — updated every 50ms tick; cache is stale before it is read
- Inventory slots during a trade — must be authoritative from the DB/WAL
- Any value that could affect anti-cheat or dupe detection

Cache is safe for: read-heavy, rarely-changing data (server list, item definitions read at startup, session tokens with short TTL).

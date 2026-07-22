/**
 * ICacheAdapter -- cache abstraction used by all Flyff servers.
 *
 * Concrete implementations:
 *  - {@link MemoryCache} -- in-process Map, for tests and single-process dev
 *  - {@link RedisCache}  -- ioredis backed, for multi-process production
 *
 * Usage keys follow the pattern `<domain>:<identifier>`, e.g.:
 *  - `token:{token}` (TTL 30s)
 *  - `session:{accountId}` (TTL 300s)
 *
 * @module cache/ICacheAdapter
 */

export interface ICacheAdapter {
  /**
   * Returns the string value for `key`, or `null` if missing / expired.
   */
  get(key: string): Promise<string | null>;

  /**
   * Stores `value` under `key`.
   *
   * @param key        - Cache key.
   * @param value      - String value to store.
   * @param ttlSeconds - Optional TTL in seconds. If omitted, the entry
   *                     persists until explicitly deleted or the process exits.
   */
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;

  /**
   * Removes the entry for `key`. No-op if the key does not exist.
   */
  del(key: string): Promise<void>;

  /**
   * Publishes `message` to `channel`.
   * Optional -- only Redis / Cloudflare KV support pub/sub.
   */
  publish?(channel: string, message: string): Promise<void>;

  /**
   * Subscribes `fn` to messages on `channel`.
   * Optional -- only Redis / Cloudflare KV support pub/sub.
   */
  subscribe?(channel: string, fn: (msg: string) => void): Promise<void>;
}

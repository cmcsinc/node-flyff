/**
 * RedisCache -- ICacheAdapter backed by ioredis.
 *
 * The constructor accepts an existing `Redis` instance (dependency-injected
 * from the composition root). It never calls `new Redis()` internally.
 *
 * Pub/sub note: ioredis does not allow a connection in subscriber mode to
 * issue regular commands. `subscribe()` therefore duplicates the provided
 * Redis connection and uses the duplicate exclusively for subscriptions.
 * That duplicate is stored and reused for all subsequent subscribe calls.
 *
 * @module cache/RedisCache
 */

import type { Redis } from 'ioredis';
import type { ICacheAdapter } from './ICacheAdapter';

export class RedisCache implements ICacheAdapter {
  private readonly redis: Redis;
  /**
   * Lazily created subscriber connection (duplicate of `redis`).
   * Null until the first call to `subscribe()`.
   */
  private subscriber: Redis | null = null;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  /**
   * Returns the string value for `key`, or `null` if missing / expired.
   */
  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  /**
   * Stores `value` under `key`.
   * If `ttlSeconds` is provided the entry expires after that many seconds
   * (uses the Redis `PX` option for millisecond precision).
   */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds !== undefined) {
      await this.redis.set(key, value, 'PX', ttlSeconds * 1_000);
    } else {
      await this.redis.set(key, value);
    }
  }

  /**
   * Removes the entry for `key`. No-op if the key does not exist.
   */
  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  /**
   * Publishes `message` to the given Redis `channel`.
   */
  async publish(channel: string, message: string): Promise<void> {
    await this.redis.publish(channel, message);
  }

  /**
   * Subscribes `fn` to messages published on `channel`.
   *
   * The first call creates a dedicated subscriber connection by duplicating
   * the main Redis client. Subsequent calls reuse the same duplicate.
   */
  async subscribe(channel: string, fn: (msg: string) => void): Promise<void> {
    if (this.subscriber === null) {
      this.subscriber = this.redis.duplicate();
    }

    this.subscriber.on('message', (ch: string, message: string) => {
      if (ch === channel) fn(message);
    });

    await this.subscriber.subscribe(channel);
  }
}

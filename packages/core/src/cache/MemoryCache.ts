/**
 * MemoryCache -- in-process ICacheAdapter backed by a plain Map.
 *
 * Intended for unit tests and single-process local development.
 * Does NOT support pub/sub -- publish/subscribe are intentionally absent.
 *
 * TTL is enforced lazily: expired entries are detected and removed on
 * the next {@link get} call for that key. No background sweep timer is
 * created, which keeps this class GC-friendly in test suites.
 *
 * @module cache/MemoryCache
 */

import type { ICacheAdapter } from './ICacheAdapter';

interface CacheEntry {
  value: string;
  /** Absolute epoch-ms expiry, or null for no expiry. */
  expiresAt: number | null;
}

export class MemoryCache implements ICacheAdapter {
  private readonly store = new Map<string, CacheEntry>();

  /**
   * Returns the stored value, or `null` if the key is missing or has expired.
   * Expired entries are deleted from the internal map on access.
   */
  get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (entry === undefined) return Promise.resolve(null);

    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return Promise.resolve(null);
    }

    return Promise.resolve(entry.value);
  }

  /**
   * Stores `value` under `key`, optionally with a TTL in seconds.
   */
  set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const expiresAt =
      ttlSeconds !== undefined ? Date.now() + ttlSeconds * 1_000 : null;
    this.store.set(key, { value, expiresAt });
    return Promise.resolve();
  }

  /**
   * Removes the entry for `key`. No-op if the key does not exist.
   */
  del(key: string): Promise<void> {
    this.store.delete(key);
    return Promise.resolve();
  }

  /**
   * Returns the number of entries currently held in the internal map,
   * including entries that may have expired but not yet been accessed.
   * Useful in tests to verify cleanup behaviour.
   */
  size(): number {
    return this.store.size;
  }
}

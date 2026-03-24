/**
 * @flyff/core — Cache subsystem public API.
 *
 * ## Usage
 * ```ts
 * import type { ICacheAdapter } from '@flyff/core/cache';
 * import { MemoryCache }        from '@flyff/core/cache';
 * import { RedisCache }         from '@flyff/core/cache';
 * ```
 *
 * @module cache
 */

export type { ICacheAdapter } from './ICacheAdapter.js';
export { MemoryCache } from './MemoryCache.js';
export { RedisCache } from './RedisCache.js';

/**
 * Unit tests for MemoryCache.
 *
 * Uses Node.js native test runner (node:test) with tsx.
 * Run: npx tsx --test packages/core/src/cache/MemoryCache.test.ts
 */

import { describe, it, before, after, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import { MemoryCache } from '../../src/cache/MemoryCache';

// ---------------------------------------------------------------------------
// get / set / del -- basic behaviour
// ---------------------------------------------------------------------------

describe('MemoryCache -- basic operations', () => {
  let cache: MemoryCache;

  before(() => {
    cache = new MemoryCache();
  });

  it('returns null for a missing key', async () => {
    const result = await cache.get('nonexistent');
    assert.equal(result, null);
  });

  it('stores and retrieves a value', async () => {
    await cache.set('greeting', 'hello');
    const result = await cache.get('greeting');
    assert.equal(result, 'hello');
  });

  it('overwrites an existing key', async () => {
    await cache.set('key', 'first');
    await cache.set('key', 'second');
    const result = await cache.get('key');
    assert.equal(result, 'second');
  });

  it('del removes a key', async () => {
    await cache.set('temp', 'data');
    await cache.del('temp');
    const result = await cache.get('temp');
    assert.equal(result, null);
  });

  it('del is a no-op for a missing key', async () => {
    await assert.doesNotReject(() => cache.del('does-not-exist'));
  });
});

// ---------------------------------------------------------------------------
// TTL behaviour (uses mock.timers to control Date.now())
// ---------------------------------------------------------------------------

describe('MemoryCache -- TTL expiry', () => {
  let cache: MemoryCache;

  before(() => {
    cache = new MemoryCache();
    // Enable fake timers so we control Date.now()
    mock.timers.enable({ apis: ['Date'] });
  });

  after(() => {
    mock.timers.reset();
  });

  it('returns value before expiry', async () => {
    await cache.set('ephemeral', 'alive', 10);
    // Advance by 5 seconds -- still within TTL
    mock.timers.tick(5_000);
    const result = await cache.get('ephemeral');
    assert.equal(result, 'alive');
  });

  it('returns null after expiry', async () => {
    await cache.set('short-lived', 'value', 5);
    // Advance by 6 seconds -- past the 5s TTL
    mock.timers.tick(6_000);
    const result = await cache.get('short-lived');
    assert.equal(result, null);
  });

  it('cleans up the internal map entry on expiry access', async () => {
    await cache.set('to-clean', 'data', 1);
    const beforeSize = cache.size();
    // Advance past TTL
    mock.timers.tick(2_000);
    await cache.get('to-clean');
    const afterSize = cache.size();
    assert.equal(afterSize, beforeSize - 1);
  });

  it('set without TTL persists indefinitely', async () => {
    await cache.set('permanent', 'stays');
    // Advance by a large amount
    mock.timers.tick(999_999_000);
    const result = await cache.get('permanent');
    assert.equal(result, 'stays');
  });
});

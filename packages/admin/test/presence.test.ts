import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { isOnline, PRESENCE_STALE_MS } from '../lib/presence';

describe('isOnline', () => {
  it('is false for a missing presence row', () => {
    assert.equal(isOnline(null), false);
    assert.equal(isOnline(undefined), false);
  });

  it('is true for a row inside the freshness window', () => {
    assert.equal(isOnline({ lastSeenMs: Date.now() }), true);
    assert.equal(isOnline({ lastSeenMs: Date.now() - PRESENCE_STALE_MS / 2 }), true);
  });

  it('is false once the row is older than the window (crashed world)', () => {
    assert.equal(isOnline({ lastSeenMs: Date.now() - PRESENCE_STALE_MS - 1 }), false);
  });

  it("uses a window wider than the world's 30 s checkpoint", () => {
    assert.ok(PRESENCE_STALE_MS > 30_000);
  });
});

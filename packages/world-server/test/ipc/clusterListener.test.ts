import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { IpcBus, signIpcMessage } from '@flyff/ipc';
import { ClusterListener, PLAYER_HANDOFF_CHANNEL } from '../../src/ipc/clusterListener.js';

/**
 * Minimal Redis double: delivers a published message back to its own
 * `message` handler so we can drive the real IpcBus (with real HMAC
 * verification) without a live Redis.
 */
class FakeRedis {
  private handler: ((channel: string, data: string) => void) | null = null;
  private subscribed = new Set<string>();
  on(event: string, handler: (channel: string, data: string) => void): void {
    if (event === 'message') this.handler = handler;
  }
  async publish(channel: string, data: string): Promise<number> {
    if (this.subscribed.has(channel) && this.handler) this.handler(channel, data);
    return 1;
  }
  async subscribe(channel: string): Promise<void> { this.subscribed.add(channel); }
  async unsubscribe(channel: string): Promise<void> { this.subscribed.delete(channel); }
  async quit(): Promise<void> { this.handler = null; }
}

const SECRET = 'test-secret';

function makeEnvelope(payload: unknown, from: string, ts: number, sig?: string) {
  return JSON.stringify({ ts, from, sig: sig ?? signIpcMessage(SECRET, payload, from, ts), payload });
}

describe('ClusterListener', () => {
  let redis: FakeRedis;
  let bus: IpcBus;
  let listener: ClusterListener;

  beforeEach(async () => {
    redis = new FakeRedis();
    bus = new IpcBus(redis, SECRET, 'world-1');
    listener = new ClusterListener({ bus });
    await listener.start();
  });

  it('stores a validly-signed handoff and yields it once (single-use)', async () => {
    const payload = { charId: 42, token: 'tok-valid', worldId: 'W1' };
    await redis.publish(PLAYER_HANDOFF_CHANNEL, makeEnvelope(payload, 'cluster-1', Date.now()));

    const got = listener.consumeByCharId(42);
    assert.equal(got?.charId, 42);
    assert.equal(got?.worldId, 'W1');

    // single-use — second consume returns null
    assert.equal(listener.consumeByCharId(42), null);
  });

  it('rejects a tampered signature', async () => {
    const payload = { charId: 7, token: 'tok-tamper', worldId: 'W1' };
    await redis.publish(
      PLAYER_HANDOFF_CHANNEL,
      makeEnvelope(payload, 'cluster-1', Date.now(), 'deadbeef'),
    );
    assert.equal(listener.consumeByCharId(7), null);
  });

  it('rejects a stale timestamp (>30s old)', async () => {
    const payload = { charId: 9, token: 'tok-stale', worldId: 'W1' };
    await redis.publish(
      PLAYER_HANDOFF_CHANNEL,
      makeEnvelope(payload, 'cluster-1', Date.now() - 40_000),
    );
    assert.equal(listener.consumeByCharId(9), null);
  });

  it('rejects a malformed payload (missing token)', async () => {
    const payload = { charId: 9, worldId: 'W1' }; // no token
    await redis.publish(PLAYER_HANDOFF_CHANNEL, makeEnvelope(payload, 'cluster-1', Date.now()));
    assert.equal(listener.consumeByCharId(9), null);
  });

  it('consumeByCharId on unknown charId returns null', () => {
    assert.equal(listener.consumeByCharId(555), null);
  });
});

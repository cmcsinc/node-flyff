import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  AdminListener,
  ADMIN_COMMAND_CHANNEL,
  type AdminCommandSink,
} from '../../src/ipc/adminListener';

/** Captures what the listener dispatched, and lets the test fire raw payloads. */
function harness() {
  const calls: Array<[string, ...unknown[]]> = [];
  const sink: AdminCommandSink = {
    kick: (charId) => calls.push(['kick', charId]),
    teleport: (charId, x, z) => calls.push(['teleport', charId, x, z]),
    mailPushed: (charId) => calls.push(['mailPushed', charId]),
  };
  let handler: ((payload: unknown, from: string) => void) | undefined;
  const bus = {
    async subscribe<T>(channel: string, h: (payload: T, from: string) => void | Promise<void>) {
      assert.equal(channel, ADMIN_COMMAND_CHANNEL);
      handler = h as (payload: unknown, from: string) => void;
    },
    unsubscribe() { handler = undefined; },
  };
  const listener = new AdminListener({ bus, sink });
  return {
    calls,
    listener,
    async start() { await listener.start(); },
    fire(payload: unknown) {
      assert.ok(handler, 'listener did not subscribe');
      handler(payload, 'admin');
    },
  };
}

describe('AdminListener', () => {
  it('dispatches kick / mail_pushed / teleport', async () => {
    const h = harness();
    await h.start();
    h.fire({ kind: 'kick', charId: 7 });
    h.fire({ kind: 'mail_pushed', charId: 8 });
    h.fire({ kind: 'teleport', charId: 9, x: 100.5, z: 200.5 });
    h.fire({ kind: 'teleport', charId: 10 });
    assert.deepEqual(h.calls, [
      ['kick', 7],
      ['mailPushed', 8],
      ['teleport', 9, 100.5, 200.5],
      ['teleport', 10, undefined, undefined],
    ]);
  });

  it('drops malformed payloads instead of dispatching', async () => {
    const h = harness();
    await h.start();
    for (const bad of [
      null,
      undefined,
      'kick',
      42,
      {},
      { kind: 'kick' },                              // no charId
      { kind: 'kick', charId: 0 },                   // charId must be positive
      { kind: 'kick', charId: -1 },
      { kind: 'kick', charId: 1.5 },                 // must be an integer
      { kind: 'kick', charId: '7' },                 // must be a number
      { kind: 'nuke', charId: 7 },                   // unknown kind
      { kind: 'teleport', charId: 7, x: 100 },       // half a coord pair
      { kind: 'teleport', charId: 7, z: 100 },
      { kind: 'teleport', charId: 7, x: 0, z: 5 },   // VecInWorld: x > 0
      { kind: 'teleport', charId: 7, x: 5, z: -1 },  // VecInWorld: z > 0
      { kind: 'teleport', charId: 7, x: NaN, z: 5 },
    ]) {
      h.fire(bad);
    }
    assert.deepEqual(h.calls, [], 'no malformed payload may reach the sink');
  });

  it('does not subscribe without a bus, and start() stays a no-op', async () => {
    const listener = new AdminListener({
      sink: { kick() { throw new Error('unreachable'); }, teleport() {}, mailPushed() {} },
    });
    await listener.start();   // must not throw
    listener.stop();          // must not throw
  });

  it('swallows a sink throw so one bad command cannot kill the subscription', async () => {
    let after = 0;
    let handler: ((p: unknown, from: string) => void) | undefined;
    const listener = new AdminListener({
      bus: {
        async subscribe<T>(_c: string, h: (p: T, from: string) => void | Promise<void>) {
          handler = h as (p: unknown, from: string) => void;
        },
        unsubscribe() {},
      },
      sink: {
        kick() { throw new Error('boom'); },
        teleport() { after++; },
        mailPushed() {},
      },
    });
    await listener.start();
    handler!({ kind: 'kick', charId: 1 }, 'admin');
    handler!({ kind: 'teleport', charId: 2 }, 'admin');
    assert.equal(after, 1, 'listener kept working after a sink throw');
  });
});

/**
 * Unit tests for LocalBus — dev-only localhost TCP pub/sub.
 *
 * Covers the two real topologies: single-process (broker is also the
 * subscriber/publisher) and two-process (one broker, one remote client). All
 * cases use a fresh ephemeral port so the suite is parallel-safe.
 */

import { describe, it, after } from 'node:test';
import * as assert from 'node:assert/strict';
import net, { type AddressInfo } from 'node:net';
import { LocalBus, createLocalBus } from '../src/localBus.js';

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/** Reserve an ephemeral port, then release it so LocalBus can rebind. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

/** Resolve on the next macrotask batch — gives frames time to cross TCP. */
const flush = (ms = 25): Promise<void> => new Promise((r) => setTimeout(r, ms));

const instances: LocalBus[] = [];
after(async () => {
  for (const bus of instances) await bus.quit();
});

describe('LocalBus', () => {
  it('delivers a published message to a same-process subscriber', async () => {
    const port = await freePort();
    const bus = await createLocalBus({ host: '127.0.0.1', port, logger: noopLogger });
    instances.push(bus);

    let received: { ch: string; data: string } | undefined;
    bus.on('message', (channel, data) => { received = { ch: channel, data }; });
    await bus.subscribe('player:handoff');
    await flush();

    await bus.publish('player:handoff', JSON.stringify({ charId: 7 }));
    await flush();

    assert.deepEqual(received, { ch: 'player:handoff', data: JSON.stringify({ charId: 7 }) });
  });

  it('delivers across two instances (one broker, one client)', async () => {
    const port = await freePort();
    // First to bind becomes the broker.
    const broker = await createLocalBus({ host: '127.0.0.1', port, logger: noopLogger });
    const client = await createLocalBus({ host: '127.0.0.1', port, logger: noopLogger });
    instances.push(broker, client);

    let received: string | undefined;
    broker.on('message', (_channel, data) => { received = data; });
    await broker.subscribe('player:handoff');
    await flush();

    // Published from the *other* instance — proves cross-process fan-out.
    await client.publish('player:handoff', JSON.stringify({ charId: 99 }));
    await flush();

    assert.equal(received, JSON.stringify({ charId: 99 }));
  });

  it('does not deliver messages from an unsubscribed channel', async () => {
    const port = await freePort();
    const broker = await createLocalBus({ host: '127.0.0.1', port, logger: noopLogger });
    const client = await createLocalBus({ host: '127.0.0.1', port, logger: noopLogger });
    instances.push(broker, client);

    let hits = 0;
    broker.on('message', () => { hits++; });
    await broker.subscribe('player:handoff');
    await flush();

    await client.publish('server:status', '{}');
    await flush();

    assert.equal(hits, 0);
  });

  it('quit() tears down without throwing', async () => {
    const port = await freePort();
    const bus = await createLocalBus({ host: '127.0.0.1', port, logger: noopLogger });
    await bus.subscribe('player:handoff');
    await assert.doesNotReject(() => bus.quit());
  });
});

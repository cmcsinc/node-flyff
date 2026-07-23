/**
 * Unit tests for IpcBus -- Redis pub/sub with HMAC signing.
 */

import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';

// Mock ioredis module
const mockMessages = new Map<string, string[]>();
const mockSubscriptions = new Set<string>();

class MockRedis {
  private eventHandlers = new Map<string, (...args: unknown[]) => void>();

  on(event: string, handler: (...args: unknown[]) => void): this {
    this.eventHandlers.set(event, handler);
    return this;
  }

  async publish(channel: string, data: string): Promise<number> {
    // Store message for testing
    if (!mockMessages.has(channel)) {
      mockMessages.set(channel, []);
    }
    mockMessages.get(channel)!.push(data);

    // Trigger message handler if subscribed
    if (mockSubscriptions.has(channel)) {
      const handler = this.eventHandlers.get('message');
      if (handler) {
        handler(channel, data);
      }
    }

    return mockSubscriptions.has(channel) ? 1 : 0;
  }

  async subscribe(channel: string): Promise<void> {
    mockSubscriptions.add(channel);
  }

  async unsubscribe(channel: string): Promise<void> {
    mockSubscriptions.delete(channel);
  }

  async quit(): Promise<void> {
    mockSubscriptions.clear();
    mockMessages.clear();
  }

  // Helper to trigger message handlers in tests
  _triggerMessage(channel: string, data: string): void {
    const handler = this.eventHandlers.get('message');
    if (handler) {
      handler(channel, data);
    }
  }
}

// Import after mock definition
import { IpcBus } from '../src/IpcBus';

describe('IpcBus', () => {
  let mockRedis: MockRedis;
  let bus: IpcBus;

  before(() => {
    // Clear mock state
    mockMessages.clear();
    mockSubscriptions.clear();
  });

  after(() => {
    mockMessages.clear();
    mockSubscriptions.clear();
  });

  it('should create an instance with Redis, secret, and serverId', () => {
    mockRedis = new MockRedis();
    bus = new IpcBus(mockRedis as unknown as any, 'test-secret', 'world-1');

    assert.equal(bus.getServerId(), 'world-1');
  });

  it('should publish signed messages to Redis', async () => {
    mockRedis = new MockRedis();
    bus = new IpcBus(mockRedis as unknown as any, 'test-secret', 'world-1');

    await bus.publish('player:handoff', { charId: 123, token: 'abc' });

    const messages = mockMessages.get('player:handoff');
    assert.ok(messages);
    assert.equal(messages.length, 1);

    const firstMessage = messages[0];
    assert.ok(firstMessage);

    const envelope = JSON.parse(firstMessage);
    assert.equal(typeof envelope.ts, 'number');
    assert.equal(envelope.from, 'world-1');
    assert.equal(typeof envelope.sig, 'string');
    assert.equal(envelope.payload.charId, 123);
    assert.equal(envelope.payload.token, 'abc');
  });

  it('should subscribe to channels and receive messages', async () => {
    mockRedis = new MockRedis();
    bus = new IpcBus(mockRedis as unknown as any, 'test-secret', 'world-1');

    const received: Array<{ payload: unknown; from: string }> = [];

    await bus.subscribe('test:channel', (payload, from) => {
      received.push({ payload, from });
    });

    // Publish a message
    await bus.publish('test:channel', { foo: 'bar' });

    // Give async handlers time to run
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(received.length, 1);
    const firstReceived = received[0];
    assert.ok(firstReceived);
    assert.deepEqual(firstReceived.payload, { foo: 'bar' });
    assert.equal(firstReceived.from, 'world-1');
  });

  it('should reject messages with invalid signatures', async () => {
    mockRedis = new MockRedis();
    bus = new IpcBus(mockRedis as unknown as any, 'test-secret', 'world-1');

    const received: unknown[] = [];

    await bus.subscribe('test:channel', (payload) => {
      received.push(payload);
    });

    // Manually trigger a message with invalid signature
    const invalidEnvelope = {
      ts: Date.now(),
      from: 'attacker',
      sig: 'invalid-signature',
      payload: { hacked: true },
    };

    mockRedis._triggerMessage('test:channel', JSON.stringify(invalidEnvelope));

    // Give async handlers time to run
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Message should be dropped silently
    assert.equal(received.length, 0);
  });

  it('should reject messages older than 30 seconds', async () => {
    mockRedis = new MockRedis();
    bus = new IpcBus(mockRedis as unknown as any, 'test-secret', 'world-1');

    const received: unknown[] = [];

    await bus.subscribe('test:channel', (payload) => {
      received.push(payload);
    });

    // Create a message with a timestamp 31 seconds ago
    const oldEnvelope = {
      ts: Date.now() - 31_000,
      from: 'world-1',
      sig: 'some-signature',
      payload: { old: true },
    };

    mockRedis._triggerMessage('test:channel', JSON.stringify(oldEnvelope));

    // Give async handlers time to run
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Old message should be dropped silently
    assert.equal(received.length, 0);
  });

  it('should unsubscribe from channels', async () => {
    mockRedis = new MockRedis();
    bus = new IpcBus(mockRedis as unknown as any, 'test-secret', 'world-1');

    await bus.subscribe('test:channel', () => {});

    const channels = bus.getSubscribedChannels();
    assert.ok(channels.has('test:channel'));

    bus.unsubscribe('test:channel');

    const channelsAfter = bus.getSubscribedChannels();
    assert.ok(!channelsAfter.has('test:channel'));
  });

  it('should close and clean up resources', async () => {
    mockRedis = new MockRedis();
    bus = new IpcBus(mockRedis as unknown as any, 'test-secret', 'world-1');

    await bus.subscribe('channel1', () => {});
    await bus.subscribe('channel2', () => {});

    assert.equal(bus.getSubscribedChannels().size, 2);

    await bus.close();

    assert.equal(bus.getSubscribedChannels().size, 0);
  });

  it('should handle handler errors gracefully', async () => {
    mockRedis = new MockRedis();
    bus = new IpcBus(mockRedis as unknown as any, 'test-secret', 'world-1');

    await bus.subscribe('test:channel', () => {
      throw new Error('Handler error');
    });

    // This should not throw, even though the handler throws
    await bus.publish('test:channel', { foo: 'bar' });

    // Give async handlers time to run
    await new Promise((resolve) => setTimeout(resolve, 10));

    // If we get here without throwing, the error was handled gracefully
    assert.ok(true);
  });
});

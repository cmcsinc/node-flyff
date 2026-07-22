/**
 * Unit tests for RedisCache.
 *
 * Uses a hand-rolled mock Redis object so no real Redis connection is needed.
 * Run: npx tsx --test packages/core/src/cache/RedisCache.test.ts
 */

import { describe, it, before } from 'node:test';
import * as assert from 'node:assert/strict';
import { RedisCache } from '../../src/cache/RedisCache.js';

// ---------------------------------------------------------------------------
// Mock Redis factory
// ---------------------------------------------------------------------------

interface MockStore {
  [key: string]: string;
}

type MessageListener = (channel: string, message: string) => void;

interface MockRedis {
  store: MockStore;
  publishedMessages: Array<{ channel: string; message: string }>;
  subscribedChannels: string[];
  messageListeners: MessageListener[];
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<'OK'>;
  set(key: string, value: string, flag: 'PX', ms: number): Promise<'OK'>;
  del(key: string): Promise<number>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string): Promise<unknown>;
  on(event: string, fn: MessageListener): MockRedis;
  duplicate(): MockRedis;
}

function makeMockRedis(): MockRedis {
  const store: MockStore = {};
  const publishedMessages: Array<{ channel: string; message: string }> = [];
  const subscribedChannels: string[] = [];
  const messageListeners: MessageListener[] = [];

  const instance: MockRedis = {
    store,
    publishedMessages,
    subscribedChannels,
    messageListeners,

    async get(key: string): Promise<string | null> {
      return Object.prototype.hasOwnProperty.call(store, key)
        ? (store[key] ?? null)
        : null;
    },

    // Overloaded signatures resolved by runtime arguments
    async set(
      key: string,
      value: string,
      ..._rest: unknown[]
    ): Promise<'OK'> {
      store[key] = value;
      return 'OK';
    },

    async del(key: string): Promise<number> {
      if (Object.prototype.hasOwnProperty.call(store, key)) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete store[key];
        return 1;
      }
      return 0;
    },

    async publish(channel: string, message: string): Promise<number> {
      publishedMessages.push({ channel, message });
      return 1;
    },

    async subscribe(channel: string): Promise<unknown> {
      subscribedChannels.push(channel);
      return ['subscribe', channel, 1];
    },

    on(event: string, fn: MessageListener): MockRedis {
      if (event === 'message') messageListeners.push(fn);
      return instance;
    },

    duplicate(): MockRedis {
      return makeMockRedis();
    },
  };

  return instance;
}

// ---------------------------------------------------------------------------
// get / set / del tests
// ---------------------------------------------------------------------------

describe('RedisCache -- get / set / del', () => {
  let mockRedis: MockRedis;
  let cache: RedisCache;

  before(() => {
    mockRedis = makeMockRedis();
    // RedisCache expects a Redis instance -- mock satisfies the duck-type shape
    cache = new RedisCache(mockRedis as unknown as import('ioredis').Redis);
  });

  it('get returns null for a missing key', async () => {
    const result = await cache.get('absent');
    assert.equal(result, null);
  });

  it('set stores a value and get retrieves it', async () => {
    await cache.set('hello', 'world');
    const result = await cache.get('hello');
    assert.equal(result, 'world');
  });

  it('set with ttlSeconds stores the value', async () => {
    await cache.set('ttl-key', 'ttl-value', 30);
    const result = await cache.get('ttl-key');
    assert.equal(result, 'ttl-value');
  });

  it('del removes a key', async () => {
    await cache.set('to-delete', 'bye');
    await cache.del('to-delete');
    const result = await cache.get('to-delete');
    assert.equal(result, null);
  });
});

// ---------------------------------------------------------------------------
// publish tests
// ---------------------------------------------------------------------------

describe('RedisCache -- publish', () => {
  let mockRedis: MockRedis;
  let cache: RedisCache;

  before(() => {
    mockRedis = makeMockRedis();
    cache = new RedisCache(mockRedis as unknown as import('ioredis').Redis);
  });

  it('publish delegates to redis.publish', async () => {
    await cache.publish('test-channel', 'my-message');
    assert.equal(mockRedis.publishedMessages.length, 1);
    assert.deepEqual(mockRedis.publishedMessages[0], {
      channel: 'test-channel',
      message: 'my-message',
    });
  });

  it('publish sends multiple messages independently', async () => {
    await cache.publish('ch-a', 'msg-1');
    await cache.publish('ch-b', 'msg-2');
    assert.equal(mockRedis.publishedMessages.length, 3); // includes one from previous test
  });
});

// ---------------------------------------------------------------------------
// subscribe tests
// ---------------------------------------------------------------------------

describe('RedisCache -- subscribe', () => {
  let cache: RedisCache;
  let subscriberMock: MockRedis;

  before(() => {
    const mainMock = makeMockRedis();
    // Override duplicate() to return a controlled subscriber mock
    subscriberMock = makeMockRedis();
    mainMock.duplicate = () => subscriberMock;
    cache = new RedisCache(mainMock as unknown as import('ioredis').Redis);
  });

  it('subscribe calls redis.subscribe on the duplicate', async () => {
    await cache.subscribe('events', () => {});
    assert.ok(subscriberMock.subscribedChannels.includes('events'));
  });

  it('subscribe registers a message listener', async () => {
    const received: string[] = [];
    await cache.subscribe('news', (msg) => received.push(msg));

    // Simulate an incoming message from Redis
    for (const fn of subscriberMock.messageListeners) {
      fn('news', 'breaking');
    }

    assert.ok(received.includes('breaking'));
  });

  it('subscribe ignores messages from other channels', async () => {
    const received: string[] = [];
    await cache.subscribe('myChannel', (msg) => received.push(msg));

    for (const fn of subscriberMock.messageListeners) {
      fn('otherChannel', 'should-be-ignored');
    }

    assert.ok(!received.includes('should-be-ignored'));
  });
});

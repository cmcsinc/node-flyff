/**
 * Mock factories and test utilities for @flyff/core tests.
 *
 * @module test/utils/mocks
 *
 * This file provides reusable mock objects and factories for testing
 * Flyff emulator components.
 */

import type { Logger } from 'pino';

/**
 * Creates a mock Pino logger that suppresses all output.
 *
 * @example
 * ```ts
 * const mockLogger = createMockLogger();
 * mockLogger.info({ userId: 1 }, 'User logged in'); // no output
 * ```
 */
export function createMockLogger(): Logger {
  const noop = () => {};
  const self = {
    level: 'silent' as const,
    child: () => self,
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    silent: noop,
  } as unknown as Logger;

  return self;
}

/**
 * Creates a mock socket with basic writable interface.
 *
 * @param overrides - Optional properties to override on the mock socket
 * @returns A mock socket object
 *
 * @example
 * ```ts
 * const socket = createMockSocket({
 *   remoteAddress: '192.168.1.1',
 * });
 *
 * const written: Buffer[] = socket._written;
 * assert.equal(written.length, 1);
 * ```
 */
export function createMockSocket(overrides: Record<string, unknown> = {}) {
  const written: Buffer[] = [];

  return {
    // Basic socket properties
    remoteAddress: '127.0.0.1',
    remotePort: 12345,
    localAddress: '127.0.0.1',
    localPort: 23000,
    writable: true,
    readable: true,

    // Session placeholder
    session: {
      state: 'connected',
      accountId: null,
      charId: null,
    },

    // Mock write method
    write: (buf: Buffer) => {
      written.push(buf);
      return true;
    },

    // Mock destroy method
    destroy: () => {},

    // Expose written buffers for assertions
    _written: written,

    ...overrides,
  };
}

/**
 * Creates a mock in-memory database for Knex.
 *
 * @returns A Knex instance configured for in-memory SQLite
 *
 * @example
 * ```ts
 * import knex from 'knex';
 *
 * const db = createMockDb();
 * await db.migrate.latest({ directory: '../../migrations' });
 * ```
 */
export async function createMockDb() {
  const knex = (await import('knex')).default;
  return knex({
    client: 'sqlite3',
    connection: ':memory:',
    useNullAsDefault: true,
  });
}

/**
 * Creates a mock EventBus for testing service-to-handler communication.
 *
 * @returns A mock event bus with emitted event tracking
 *
 * @example
 * ```ts
 * const bus = createMockEventBus();
 * await someService.doSomething();
 *
 * const emitted = bus._emitted;
 * assert.equal(emitted.length, 1);
 * assert.equal(emitted[0][0], 'PLAYER_MOVED');
 * ```
 */
export function createMockEventBus() {
  const emitted: Array<[string, unknown]> = [];

  return {
    emit: (event: string, data: unknown) => {
      emitted.push([event, data]);
    },

    // Expose emitted events for assertions
    _emitted: emitted,

    // Add on/off for more complex scenarios
    _listeners: new Map<string, Array<(data: unknown) => void>>(),

    on: (event: string, fn: (data: unknown) => void) => {
      const listeners = (createMockEventBus as any)._listeners;
      if (!listeners.has(event)) {
        listeners.set(event, []);
      }
      listeners.get(event)!.push(fn);
    },

    off: (event: string, fn: (data: unknown) => void) => {
      const listeners = (createMockEventBus as any)._listeners;
      const eventListeners = listeners.get(event);
      if (eventListeners) {
        const index = eventListeners.indexOf(fn);
        if (index > -1) {
          eventListeners.splice(index, 1);
        }
      }
    },
  };
}

/**
 * Creates a mock cache adapter (in-memory Map-based).
 *
 * @returns A mock ICacheAdapter implementation
 *
 * @example
 * ```ts
 * const cache = createMockCache();
 * await cache.set('key', 'value', 60);
 * const value = await cache.get('key');
 * assert.equal(value, 'value');
 * ```
 */
export function createMockCache() {
  const store = new Map<string, { value: string; expires: number | null }>();

  return {
    get: async (key: string) => {
      const entry = store.get(key);
      if (!entry) return null;

      if (entry.expires && Date.now() > entry.expires) {
        store.delete(key);
        return null;
      }

      return entry.value;
    },

    set: async (key: string, value: string, ttlSeconds?: number) => {
      const expires = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
      store.set(key, { value, expires });
    },

    del: async (key: string) => {
      store.delete(key);
    },

    // For testing: inspect internal state
    _store: store,
  };
}

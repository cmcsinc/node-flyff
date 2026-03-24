/**
 * Tests for the Cluster Server configuration Zod schema.
 *
 * @module config/schemas/cluster.schema.test
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ZodError } from 'zod';

import {
  ClusterServerConfigSchema,
  CharacterDefaultsSchema,
  ClusterRegistrationConfigSchema,
} from './cluster.schema.js';

// ---------------------------------------------------------------------------
// Minimal valid base fields required by BaseConfigSchema
// ---------------------------------------------------------------------------

/** Minimum input required to satisfy BaseConfigSchema + ClusterServerConfigSchema. */
const validBase = {
  server: { id: 'cluster-1', port: 38100 },
  ipc: { secret: 'supersecretvalue16' },
};

describe('ClusterServerConfigSchema', () => {
  // -------------------------------------------------------------------------
  // Happy path — valid minimal config
  // -------------------------------------------------------------------------

  it('parses a valid minimal config and applies all defaults', () => {
    const result = ClusterServerConfigSchema.parse(validBase);

    // Server network
    assert.equal(result.server.id, 'cluster-1');
    assert.equal(result.server.port, 38100);
    assert.equal(result.server.host, '0.0.0.0'); // default

    // IPC
    assert.equal(result.ipc.secret, 'supersecretvalue16');
    assert.equal(result.ipc.internalPort, 29000); // default

    // Log defaults
    assert.equal(result.log.level, 'info');
    assert.equal(result.log.pretty, false);

    // DB defaults
    assert.equal(result.database.client, 'sqlite3');

    // Cache defaults
    assert.equal(result.cache.adapter, 'memory');

    // Character defaults
    assert.equal(result.character.maxPerAccount, 3);
    assert.equal(result.character.startMap, 'WI_WORLD_FLARIS');
    assert.equal(result.character.startLevel, 1);
    assert.equal(result.character.startGold, 0);
    assert.equal(result.character.startInventorySize, 42);

    // Registration defaults
    assert.equal(result.registration.internalPort, 29000);
    assert.deepEqual(result.registration.allowedWorlds, []);
    assert.equal(result.registration.loginHost, '127.0.0.1');
    assert.equal(result.registration.loginInternalPort, 29001);
    assert.equal(result.registration.reconnectIntervalMs, 5000);
    assert.equal(result.registration.heartbeatIntervalMs, 5000);
    assert.equal(result.registration.worldHeartbeatTimeoutMs, 15000);
  });

  it('accepts custom character and registration overrides', () => {
    const input = {
      ...validBase,
      character: {
        maxPerAccount: 6,
        startMap: 'WI_WORLD_SAINT_MORNING',
        startLevel: 10,
        startGold: 1000,
        startX: 0,
        startY: 0,
        startZ: 0,
        startInventorySize: 50,
      },
      registration: {
        internalPort: 30000,
        allowedWorlds: ['world-1', 'world-2'],
        loginHost: '10.0.0.1',
        loginInternalPort: 30001,
        reconnectIntervalMs: 10000,
        heartbeatIntervalMs: 3000,
        worldHeartbeatTimeoutMs: 9000,
      },
    };

    const result = ClusterServerConfigSchema.parse(input);
    assert.equal(result.character.maxPerAccount, 6);
    assert.equal(result.character.startMap, 'WI_WORLD_SAINT_MORNING');
    assert.equal(result.character.startLevel, 10);
    assert.equal(result.character.startGold, 1000);
    assert.equal(result.character.startInventorySize, 50);
    assert.equal(result.registration.internalPort, 30000);
    assert.deepEqual(result.registration.allowedWorlds, ['world-1', 'world-2']);
    assert.equal(result.registration.loginHost, '10.0.0.1');
  });

  // -------------------------------------------------------------------------
  // Missing required fields
  // -------------------------------------------------------------------------

  it('throws ZodError when server field is missing', () => {
    assert.throws(
      () => ClusterServerConfigSchema.parse({ ipc: { secret: 'supersecretvalue16' } }),
      (err: unknown) => err instanceof ZodError,
    );
  });

  it('throws ZodError when ipc.secret is missing', () => {
    assert.throws(
      () => ClusterServerConfigSchema.parse({ server: { id: 'cluster-1', port: 38100 } }),
      (err: unknown) => err instanceof ZodError,
    );
  });

  it('throws ZodError when server.id is missing', () => {
    assert.throws(
      () =>
        ClusterServerConfigSchema.parse({
          server: { port: 38100 },
          ipc: { secret: 'supersecretvalue16' },
        }),
      (err: unknown) => err instanceof ZodError,
    );
  });

  it('throws ZodError when server.port is missing', () => {
    assert.throws(
      () =>
        ClusterServerConfigSchema.parse({
          server: { id: 'cluster-1' },
          ipc: { secret: 'supersecretvalue16' },
        }),
      (err: unknown) => err instanceof ZodError,
    );
  });

  // -------------------------------------------------------------------------
  // Wrong types
  // -------------------------------------------------------------------------

  it('throws ZodError when server.port is a string', () => {
    assert.throws(
      () =>
        ClusterServerConfigSchema.parse({
          server: { id: 'cluster-1', port: 'not-a-number' },
          ipc: { secret: 'supersecretvalue16' },
        }),
      (err: unknown) => err instanceof ZodError,
    );
  });

  it('throws ZodError when ipc.secret is too short (< 16 chars)', () => {
    assert.throws(
      () =>
        ClusterServerConfigSchema.parse({
          server: { id: 'cluster-1', port: 38100 },
          ipc: { secret: 'short' },
        }),
      (err: unknown) => err instanceof ZodError,
    );
  });

  it('throws ZodError when log.level is an invalid enum value', () => {
    assert.throws(
      () =>
        ClusterServerConfigSchema.parse({
          ...validBase,
          log: { level: 'verbose' }, // not in allowed enum
        }),
      (err: unknown) => err instanceof ZodError,
    );
  });

  it('throws ZodError when database.client is an unrecognised adapter', () => {
    assert.throws(
      () =>
        ClusterServerConfigSchema.parse({
          ...validBase,
          database: { client: 'oracle' },
        }),
      (err: unknown) => err instanceof ZodError,
    );
  });
});

// ---------------------------------------------------------------------------
// CharacterDefaultsSchema — isolated unit tests
// ---------------------------------------------------------------------------

describe('CharacterDefaultsSchema', () => {
  it('applies all defaults for empty input', () => {
    const result = CharacterDefaultsSchema.parse({});
    assert.equal(result.maxPerAccount, 3);
    assert.equal(result.startMap, 'WI_WORLD_FLARIS');
    assert.equal(result.startX, 3068.0);
    assert.equal(result.startY, 31.0);
    assert.equal(result.startZ, 3176.0);
    assert.equal(result.startLevel, 1);
    assert.equal(result.startGold, 0);
    assert.equal(result.startInventorySize, 42);
  });

  it('throws ZodError when maxPerAccount exceeds 20', () => {
    assert.throws(
      () => CharacterDefaultsSchema.parse({ maxPerAccount: 21 }),
      (err: unknown) => err instanceof ZodError,
    );
  });

  it('throws ZodError when startLevel exceeds 999', () => {
    assert.throws(
      () => CharacterDefaultsSchema.parse({ startLevel: 1000 }),
      (err: unknown) => err instanceof ZodError,
    );
  });

  it('throws ZodError when startGold is negative', () => {
    assert.throws(
      () => CharacterDefaultsSchema.parse({ startGold: -1 }),
      (err: unknown) => err instanceof ZodError,
    );
  });

  it('throws ZodError when startInventorySize is below minimum (10)', () => {
    assert.throws(
      () => CharacterDefaultsSchema.parse({ startInventorySize: 5 }),
      (err: unknown) => err instanceof ZodError,
    );
  });
});

// ---------------------------------------------------------------------------
// ClusterRegistrationConfigSchema — isolated unit tests
// ---------------------------------------------------------------------------

describe('ClusterRegistrationConfigSchema', () => {
  it('applies all defaults for empty input', () => {
    const result = ClusterRegistrationConfigSchema.parse({});
    assert.equal(result.internalPort, 29000);
    assert.deepEqual(result.allowedWorlds, []);
    assert.equal(result.loginHost, '127.0.0.1');
    assert.equal(result.loginInternalPort, 29001);
    assert.equal(result.reconnectIntervalMs, 5000);
    assert.equal(result.heartbeatIntervalMs, 5000);
    assert.equal(result.worldHeartbeatTimeoutMs, 15000);
  });

  it('throws ZodError when internalPort is below 1024', () => {
    assert.throws(
      () => ClusterRegistrationConfigSchema.parse({ internalPort: 80 }),
      (err: unknown) => err instanceof ZodError,
    );
  });

  it('throws ZodError when reconnectIntervalMs is below 1000', () => {
    assert.throws(
      () => ClusterRegistrationConfigSchema.parse({ reconnectIntervalMs: 500 }),
      (err: unknown) => err instanceof ZodError,
    );
  });

  it('throws ZodError when worldHeartbeatTimeoutMs is below 5000', () => {
    assert.throws(
      () => ClusterRegistrationConfigSchema.parse({ worldHeartbeatTimeoutMs: 1000 }),
      (err: unknown) => err instanceof ZodError,
    );
  });

  it('accepts an allowedWorlds list of strings', () => {
    const result = ClusterRegistrationConfigSchema.parse({
      allowedWorlds: ['world-1', 'world-2'],
    });
    assert.deepEqual(result.allowedWorlds, ['world-1', 'world-2']);
  });
});

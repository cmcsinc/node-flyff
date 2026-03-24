/**
 * Tests for the World Server configuration Zod schema.
 *
 * @module config/schemas/world.schema.test
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ZodError } from 'zod';

import {
  WorldServerConfigSchema,
  WorldSimConfigSchema,
  ZoneConfigSchema,
  WalConfigSchema,
  WorldRegistrationConfigSchema,
} from './world.schema.js';

// ---------------------------------------------------------------------------
// Minimal valid base fields required by BaseConfigSchema
// ---------------------------------------------------------------------------

/** Minimum input required to satisfy BaseConfigSchema + WorldServerConfigSchema. */
const validBase = {
  server: { id: 'world-1', port: 38180 },
  ipc: { secret: 'supersecretvalue16' },
};

describe('WorldServerConfigSchema', () => {
  // -------------------------------------------------------------------------
  // Happy path — valid minimal config
  // -------------------------------------------------------------------------

  it('parses a valid minimal config and applies all defaults', () => {
    const result = WorldServerConfigSchema.parse(validBase);

    // Server network
    assert.equal(result.server.id, 'world-1');
    assert.equal(result.server.port, 38180);
    assert.equal(result.server.host, '0.0.0.0'); // default

    // IPC
    assert.equal(result.ipc.secret, 'supersecretvalue16');
    assert.equal(result.ipc.internalPort, 29000); // default

    // Log defaults
    assert.equal(result.log.level, 'info');
    assert.equal(result.log.pretty, false);

    // DB defaults
    assert.equal(result.database.client, 'sqlite3');
    assert.equal(result.database.filename, './data/flyff_dev.sqlite3');

    // Cache defaults
    assert.equal(result.cache.adapter, 'memory');

    // World simulation defaults
    assert.equal(result.world.tickRateMs, 50);
    assert.equal(result.world.maxPlayers, 500);
    assert.equal(result.world.expRate, 1.0);
    assert.equal(result.world.dropRate, 1.0);
    assert.equal(result.world.goldRate, 1.0);
    assert.equal(result.world.spawnMultiplier, 1.0);

    // Zone defaults
    assert.equal(result.zone.broadcastRadius, 75.0);
    assert.equal(result.zone.persistIntervalMs, 30_000);

    // WAL defaults
    assert.equal(result.wal.journalPath, './data/world_journal.sqlite3');
    assert.equal(result.wal.syncBatchSize, 100);

    // Registration defaults
    assert.equal(result.registration.clusterHost, '127.0.0.1');
    assert.equal(result.registration.clusterInternalPort, 29000);
    assert.equal(result.registration.channelId, 1);
    assert.equal(result.registration.channelName, 'Channel 1');
    assert.equal(result.registration.reconnectIntervalMs, 5000);
    assert.equal(result.registration.heartbeatIntervalMs, 5000);
  });

  it('accepts fully customised rate multipliers and WAL settings', () => {
    const input = {
      ...validBase,
      world: {
        tickRateMs: 100,
        maxPlayers: 200,
        expRate: 2.5,
        dropRate: 3.0,
        goldRate: 1.5,
        spawnMultiplier: 2.0,
      },
      zone: {
        broadcastRadius: 50.0,
        persistIntervalMs: 10_000,
      },
      wal: {
        journalPath: './data/custom_journal.sqlite3',
        syncBatchSize: 50,
      },
      registration: {
        clusterHost: '192.168.1.100',
        clusterInternalPort: 31000,
        channelId: 3,
        channelName: 'Flaris Ch.3',
        reconnectIntervalMs: 2000,
        heartbeatIntervalMs: 3000,
      },
    };

    const result = WorldServerConfigSchema.parse(input);

    assert.equal(result.world.tickRateMs, 100);
    assert.equal(result.world.maxPlayers, 200);
    assert.equal(result.world.expRate, 2.5);
    assert.equal(result.world.dropRate, 3.0);
    assert.equal(result.world.goldRate, 1.5);
    assert.equal(result.world.spawnMultiplier, 2.0);
    assert.equal(result.zone.broadcastRadius, 50.0);
    assert.equal(result.zone.persistIntervalMs, 10_000);
    assert.equal(result.wal.journalPath, './data/custom_journal.sqlite3');
    assert.equal(result.wal.syncBatchSize, 50);
    assert.equal(result.registration.clusterHost, '192.168.1.100');
    assert.equal(result.registration.channelId, 3);
    assert.equal(result.registration.channelName, 'Flaris Ch.3');
  });

  // -------------------------------------------------------------------------
  // Missing required fields
  // -------------------------------------------------------------------------

  it('throws ZodError when server field is missing', () => {
    assert.throws(
      () => WorldServerConfigSchema.parse({ ipc: { secret: 'supersecretvalue16' } }),
      (err: unknown) => err instanceof ZodError,
    );
  });

  it('throws ZodError when ipc.secret is missing', () => {
    assert.throws(
      () => WorldServerConfigSchema.parse({ server: { id: 'world-1', port: 38180 } }),
      (err: unknown) => err instanceof ZodError,
    );
  });

  it('throws ZodError when server.id is missing', () => {
    assert.throws(
      () =>
        WorldServerConfigSchema.parse({
          server: { port: 38180 },
          ipc: { secret: 'supersecretvalue16' },
        }),
      (err: unknown) => err instanceof ZodError,
    );
  });

  it('throws ZodError when server.port is missing', () => {
    assert.throws(
      () =>
        WorldServerConfigSchema.parse({
          server: { id: 'world-1' },
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
        WorldServerConfigSchema.parse({
          server: { id: 'world-1', port: 'thirty-eight-one-eighty' },
          ipc: { secret: 'supersecretvalue16' },
        }),
      (err: unknown) => err instanceof ZodError,
    );
  });

  it('throws ZodError when ipc.secret is shorter than 16 characters', () => {
    assert.throws(
      () =>
        WorldServerConfigSchema.parse({
          server: { id: 'world-1', port: 38180 },
          ipc: { secret: 'tooshort' },
        }),
      (err: unknown) => err instanceof ZodError,
    );
  });

  it('throws ZodError when log.level has an invalid value', () => {
    assert.throws(
      () =>
        WorldServerConfigSchema.parse({
          ...validBase,
          log: { level: 'verbose' },
        }),
      (err: unknown) => err instanceof ZodError,
    );
  });

  it('throws ZodError when cache.adapter is an unrecognised value', () => {
    assert.throws(
      () =>
        WorldServerConfigSchema.parse({
          ...validBase,
          cache: { adapter: 'memcached' },
        }),
      (err: unknown) => err instanceof ZodError,
    );
  });
});

// ---------------------------------------------------------------------------
// WorldSimConfigSchema — isolated unit tests
// ---------------------------------------------------------------------------

describe('WorldSimConfigSchema', () => {
  it('applies all defaults for empty input', () => {
    const result = WorldSimConfigSchema.parse({});
    assert.equal(result.tickRateMs, 50);
    assert.equal(result.maxPlayers, 500);
    assert.equal(result.expRate, 1.0);
    assert.equal(result.dropRate, 1.0);
    assert.equal(result.goldRate, 1.0);
    assert.equal(result.spawnMultiplier, 1.0);
  });

  it('throws ZodError when tickRateMs is below minimum (10)', () => {
    assert.throws(
      () => WorldSimConfigSchema.parse({ tickRateMs: 5 }),
      (err: unknown) => err instanceof ZodError,
    );
  });

  it('throws ZodError when tickRateMs exceeds maximum (500)', () => {
    assert.throws(
      () => WorldSimConfigSchema.parse({ tickRateMs: 501 }),
      (err: unknown) => err instanceof ZodError,
    );
  });

  it('throws ZodError when expRate is zero or negative', () => {
    assert.throws(
      () => WorldSimConfigSchema.parse({ expRate: 0 }),
      (err: unknown) => err instanceof ZodError,
    );
  });

  it('throws ZodError when dropRate is negative', () => {
    assert.throws(
      () => WorldSimConfigSchema.parse({ dropRate: -1 }),
      (err: unknown) => err instanceof ZodError,
    );
  });

  it('accepts high multiplier values (custom rates)', () => {
    const result = WorldSimConfigSchema.parse({ expRate: 100.0, spawnMultiplier: 5.0 });
    assert.equal(result.expRate, 100.0);
    assert.equal(result.spawnMultiplier, 5.0);
  });
});

// ---------------------------------------------------------------------------
// ZoneConfigSchema — isolated unit tests
// ---------------------------------------------------------------------------

describe('ZoneConfigSchema', () => {
  it('applies all defaults for empty input', () => {
    const result = ZoneConfigSchema.parse({});
    assert.equal(result.broadcastRadius, 75.0);
    assert.equal(result.persistIntervalMs, 30_000);
  });

  it('throws ZodError when broadcastRadius is zero or negative', () => {
    assert.throws(
      () => ZoneConfigSchema.parse({ broadcastRadius: 0 }),
      (err: unknown) => err instanceof ZodError,
    );
  });

  it('throws ZodError when persistIntervalMs is below 5000', () => {
    assert.throws(
      () => ZoneConfigSchema.parse({ persistIntervalMs: 4999 }),
      (err: unknown) => err instanceof ZodError,
    );
  });

  it('accepts valid overrides', () => {
    const result = ZoneConfigSchema.parse({ broadcastRadius: 100.0, persistIntervalMs: 60_000 });
    assert.equal(result.broadcastRadius, 100.0);
    assert.equal(result.persistIntervalMs, 60_000);
  });
});

// ---------------------------------------------------------------------------
// WalConfigSchema — isolated unit tests
// ---------------------------------------------------------------------------

describe('WalConfigSchema', () => {
  it('applies all defaults for empty input', () => {
    const result = WalConfigSchema.parse({});
    assert.equal(result.journalPath, './data/world_journal.sqlite3');
    assert.equal(result.syncBatchSize, 100);
  });

  it('throws ZodError when syncBatchSize is below minimum (1)', () => {
    assert.throws(
      () => WalConfigSchema.parse({ syncBatchSize: 0 }),
      (err: unknown) => err instanceof ZodError,
    );
  });

  it('accepts custom journal path and batch size', () => {
    const result = WalConfigSchema.parse({
      journalPath: '/var/data/world_1.sqlite3',
      syncBatchSize: 500,
    });
    assert.equal(result.journalPath, '/var/data/world_1.sqlite3');
    assert.equal(result.syncBatchSize, 500);
  });
});

// ---------------------------------------------------------------------------
// WorldRegistrationConfigSchema — isolated unit tests
// ---------------------------------------------------------------------------

describe('WorldRegistrationConfigSchema', () => {
  it('applies all defaults for empty input', () => {
    const result = WorldRegistrationConfigSchema.parse({});
    assert.equal(result.clusterHost, '127.0.0.1');
    assert.equal(result.clusterInternalPort, 29000);
    assert.equal(result.channelId, 1);
    assert.equal(result.channelName, 'Channel 1');
    assert.equal(result.reconnectIntervalMs, 5000);
    assert.equal(result.heartbeatIntervalMs, 5000);
  });

  it('throws ZodError when clusterInternalPort is below 1024', () => {
    assert.throws(
      () => WorldRegistrationConfigSchema.parse({ clusterInternalPort: 80 }),
      (err: unknown) => err instanceof ZodError,
    );
  });

  it('throws ZodError when channelId is below 1', () => {
    assert.throws(
      () => WorldRegistrationConfigSchema.parse({ channelId: 0 }),
      (err: unknown) => err instanceof ZodError,
    );
  });

  it('throws ZodError when channelName is empty string', () => {
    assert.throws(
      () => WorldRegistrationConfigSchema.parse({ channelName: '' }),
      (err: unknown) => err instanceof ZodError,
    );
  });

  it('throws ZodError when reconnectIntervalMs is below 1000', () => {
    assert.throws(
      () => WorldRegistrationConfigSchema.parse({ reconnectIntervalMs: 999 }),
      (err: unknown) => err instanceof ZodError,
    );
  });

  it('accepts valid channel configuration', () => {
    const result = WorldRegistrationConfigSchema.parse({
      clusterHost: '10.0.0.5',
      clusterInternalPort: 31000,
      channelId: 2,
      channelName: 'Madrigal Ch.2',
    });
    assert.equal(result.clusterHost, '10.0.0.5');
    assert.equal(result.clusterInternalPort, 31000);
    assert.equal(result.channelId, 2);
    assert.equal(result.channelName, 'Madrigal Ch.2');
  });
});

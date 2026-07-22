/**
 * World Server configuration schema.
 *
 * Extends {@link BaseConfigSchema} with gameplay and simulation settings:
 * - Game loop tick rate
 * - Experience / drop / gold rate multipliers
 * - Zone broadcast radius
 * - Dirty-flush persistence interval
 * - WAL journal path for crash recovery
 * - Registration handshake settings (Cluster Server connection)
 *
 * @module config/schemas/world
 */

import { z } from 'zod';
import { BaseConfigSchema } from './base.schema.js';

// ---------------------------------------------------------------------------
// World simulation sub-schema
// ---------------------------------------------------------------------------

/** Core world-server simulation and rate settings. */
export const WorldSimConfigSchema = z.object({
  /** Game loop tick interval in milliseconds. Target: <=10 ms processing per tick. */
  tickRateMs: z.number().int().min(10).max(500).default(50),
  /** Maximum simultaneous player connections this world server accepts. */
  maxPlayers: z.number().int().min(1).default(500),
  /** Experience point rate multiplier (1.0 = retail). */
  expRate: z.number().positive().default(1.0),
  /** Item drop rate multiplier (1.0 = retail). */
  dropRate: z.number().positive().default(1.0),
  /** Gold (penya) drop rate multiplier (1.0 = retail). */
  goldRate: z.number().positive().default(1.0),
  /** Spawn density multiplier. Values > 1.0 increase monster population. */
  spawnMultiplier: z.number().positive().default(1.0),
});

// ---------------------------------------------------------------------------
// Zone sub-schema
// ---------------------------------------------------------------------------

/** Zone and area-of-interest broadcasting settings. */
export const ZoneConfigSchema = z.object({
  /**
   * Radius (world units) within which a player receives broadcast packets.
   * Keep lower to reduce bandwidth on busy servers.
   */
  broadcastRadius: z.number().positive().default(75.0),
  /**
   * How often (ms) dirty player state is flushed from memory to the main DB.
   * Critical changes (level-up, items) are written to the WAL journal
   * immediately -- this interval only covers low-priority dirty fields.
   */
  persistIntervalMs: z.number().int().min(5000).default(30_000),
});

// ---------------------------------------------------------------------------
// Registration sub-schema (World -> Cluster connection)
// ---------------------------------------------------------------------------

/**
 * Settings that control how this World Server locates and registers with
 * its parent Cluster Server on startup.
 */
export const WorldRegistrationConfigSchema = z.object({
  /** Hostname or IP of the Cluster Server's internal IpcServer. */
  clusterHost: z.string().default('127.0.0.1'),
  /** Internal TCP port the Cluster Server's IpcServer listens on. */
  clusterInternalPort: z.number().int().min(1024).max(65535).default(29000),
  /** Which channel index this world represents in the cluster (1-based). */
  channelId: z.number().int().min(1).default(1),
  /**
   * Display name for this channel shown in the client's server/channel selector.
   * e.g. "Madrigal Ch.1"
   */
  channelName: z.string().min(1).default('Channel 1'),
  /** Milliseconds between reconnect attempts if the Cluster connection drops. */
  reconnectIntervalMs: z.number().int().min(1000).default(5000),
  /** Milliseconds between WORLD_HEARTBEAT pings sent to the Cluster. */
  heartbeatIntervalMs: z.number().int().min(1000).default(5000),
});

// ---------------------------------------------------------------------------
// Resources sub-schema
// ---------------------------------------------------------------------------

/** Game resources (items, movers, skills, zones) loader settings. */
export const ResourcesConfigSchema = z.object({
  /**
   * Path to the resources/data directory containing YAML files.
   * Relative to the project root or absolute.
   */
  dataDir: z.string().default('./resources/data'),
  /**
   * Enable hot-reload in development mode.
   * Watches resource files for changes and reloads automatically.
   */
  hotReload: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// WAL persistence sub-schema
// ---------------------------------------------------------------------------

/** Embedded SQLite Write-Ahead Log (WAL) journal for crash recovery. */
export const WalConfigSchema = z.object({
  /**
   * File path of the per-world-server WAL journal.
   * Use a path on the same machine as the server process for 0-latency writes.
   * Separate from the main DB so it never DDoS-es PostgreSQL.
   */
  journalPath: z.string().default('./data/world_journal.sqlite3'),
  /**
   * How many WAL entries to batch before forcing an fsync.
   * Lower values = safer on crash, higher values = better throughput.
   */
  syncBatchSize: z.number().int().min(1).default(100),
});

// ---------------------------------------------------------------------------
// World server schema
// ---------------------------------------------------------------------------

/**
 * Full configuration schema for the World Server.
 *
 * @example
 * ```ts
 * import { loadConfig } from '@flyff/core/config';
 * import { WorldServerConfigSchema } from '@flyff/core/config/schemas/world.js';
 *
 * const config = loadConfig('world-server', WorldServerConfigSchema);
 * ```
 */
export const WorldServerConfigSchema = BaseConfigSchema.merge(
  z.object({
    world: WorldSimConfigSchema.default({}),
    zone: ZoneConfigSchema.default({}),
    wal: WalConfigSchema.default({}),
    registration: WorldRegistrationConfigSchema.default({}),
    resources: ResourcesConfigSchema.default({}),
  }),
);

/** Inferred TypeScript type for the World Server config. */
export type WorldServerConfig = z.infer<typeof WorldServerConfigSchema>;

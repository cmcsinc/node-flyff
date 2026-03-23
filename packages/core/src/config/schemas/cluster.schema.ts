/**
 * Cluster Server configuration schema.
 *
 * Extends {@link BaseConfigSchema} with character-management settings:
 * - Max characters per account
 * - New-character defaults (map, position, level, starting gold)
 * - Registration handshake settings (World Server acceptance + Login Server connection)
 *
 * @module config/schemas/cluster
 */

import { z } from 'zod';
import { BaseConfigSchema } from './base.schema.js';

// ---------------------------------------------------------------------------
// Character creation defaults sub-schema
// ---------------------------------------------------------------------------

/** Default values applied when a new character is created. */
export const CharacterDefaultsSchema = z.object({
  /** Maximum characters allowed per account. */
  maxPerAccount: z.number().int().min(1).max(20).default(3),
  /**
   * Resource name of the starting map (must match a world .wld file name).
   * e.g. "WI_WORLD_FLARIS"
   */
  startMap: z.string().min(1).default('WI_WORLD_FLARIS'),
  /** Starting X world coordinate. */
  startX: z.number().default(3068.0),
  /** Starting Y world coordinate (height). */
  startY: z.number().default(31.0),
  /** Starting Z world coordinate. */
  startZ: z.number().default(3176.0),
  /** Starting character level. */
  startLevel: z.number().int().min(1).max(999).default(1),
  /** Starting gold amount (penya). */
  startGold: z.number().int().min(0).default(0),
  /** Starting inventory slot count. */
  startInventorySize: z.number().int().min(10).max(100).default(42),
});

// ---------------------------------------------------------------------------
// Registration sub-schema (Cluster ↔ World + Cluster → Login)
// ---------------------------------------------------------------------------

/**
 * Settings that control how this Cluster Server:
 *  1. Accepts incoming World Server registrations (acts as IpcServer)
 *  2. Registers itself with the Login Server (acts as IpcClient)
 */
export const ClusterRegistrationConfigSchema = z.object({
  /**
   * Internal TCP port this Cluster Server binds for incoming World Server
   * registrations. World Servers connect here on startup.
   */
  internalPort: z.number().int().min(1024).max(65535).default(29000),
  /**
   * Allowlist of World Server IDs that are permitted to register.
   * A World Server whose `serverId` is not in this list will be rejected
   * even if its HMAC token is valid.
   */
  allowedWorlds: z.array(z.string().min(1)).default([]),
  /** Hostname or IP of the Login Server's internal IpcServer. */
  loginHost: z.string().default('127.0.0.1'),
  /** Internal TCP port of the Login Server's IpcServer. */
  loginInternalPort: z.number().int().min(1024).max(65535).default(29001),
  /** Milliseconds between reconnect attempts if the Login connection drops. */
  reconnectIntervalMs: z.number().int().min(1000).default(5000),
  /** Milliseconds between CLUSTER_HEARTBEAT pings sent to the Login Server. */
  heartbeatIntervalMs: z.number().int().min(1000).default(5000),
  /**
   * How long (ms) to wait without a WORLD_HEARTBEAT before declaring a
   * World Server dead. Should be at least 2× the world's heartbeatIntervalMs.
   */
  worldHeartbeatTimeoutMs: z.number().int().min(5000).default(15000),
});

// ---------------------------------------------------------------------------
// Cluster server schema
// ---------------------------------------------------------------------------

/**
 * Full configuration schema for the Cluster Server.
 *
 * @example
 * ```ts
 * import { loadConfig } from '@flyff/core/config';
 * import { ClusterServerConfigSchema } from '@flyff/core/config/schemas/cluster.js';
 *
 * const config = loadConfig('cluster-server', ClusterServerConfigSchema);
 * ```
 */
export const ClusterServerConfigSchema = BaseConfigSchema.merge(
  z.object({
    character: CharacterDefaultsSchema.default({}),
    registration: ClusterRegistrationConfigSchema.default({}),
  }),
);

/** Inferred TypeScript type for the Cluster Server config. */
export type ClusterServerConfig = z.infer<typeof ClusterServerConfigSchema>;

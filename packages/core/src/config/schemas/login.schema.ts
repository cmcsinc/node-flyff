/**
 * Login Server configuration schema.
 *
 * Extends {@link BaseConfigSchema} with login-specific settings:
 * - Argon2 password hashing parameters
 * - One-time session token TTL
 * - Rate-limiting / lockout policy
 * - The list of cluster servers advertised to clients
 *
 * @module config/schemas/login
 */

import { z } from 'zod';
import { BaseConfigSchema } from './base.schema.js';

// ---------------------------------------------------------------------------
// Auth sub-schema
// ---------------------------------------------------------------------------

/** Argon2 and session-token security settings. */
export const AuthConfigSchema = z.object({
  /** Argon2id memory cost in KiB. Lower values speed up dev. */
  argon2MemoryCost: z.number().int().min(8192).default(65536),
  /** Argon2id time cost (iterations). */
  argon2TimeCost: z.number().int().min(1).default(3),
  /** Argon2id parallelism factor. */
  argon2Parallelism: z.number().int().min(1).default(1),
  /**
   * How long (ms) a one-time session token remains valid
   * before the cluster server rejects it.
   */
  tokenTtlMs: z.number().int().min(5000).default(30000),
  /** Maximum consecutive failed login attempts before lockout. */
  maxLoginAttempts: z.number().int().min(1).default(5),
  /** How long (ms) an account is locked after hitting maxLoginAttempts. */
  lockoutDurationMs: z.number().int().min(0).default(300_000),
});

// ---------------------------------------------------------------------------
// Server list sub-schema
// ---------------------------------------------------------------------------

/** A single cluster server entry advertised to the client on login. */
export const ClusterEntrySchema = z.object({
  /** Display name shown in the server selection screen. */
  name: z.string().min(1),
  /** Public IP address or hostname clients connect to. */
  ip: z.string().min(7),
  /** Public port of the cluster/cache server (v15 default PN_CACHESRVR = 5400). */
  port: z.number().int().min(1).max(65535).default(5400),
  /** Number of channels / world-server instances under this cluster. */
  channels: z.number().int().min(1).default(1),
});

// ---------------------------------------------------------------------------
// Registration sub-schema (Login accepts Cluster registrations)
// ---------------------------------------------------------------------------

/**
 * Settings that control how the Login Server accepts and validates
 * incoming Cluster Server registrations.
 */
export const LoginRegistrationConfigSchema = z.object({
  /**
   * Internal TCP port this Login Server binds for incoming Cluster Server
   * registrations. Cluster Servers connect here on startup.
   */
  internalPort: z.number().int().min(1024).max(65535).default(29001),
  /**
   * Allowlist of Cluster Server IDs that are permitted to register.
   * A Cluster Server whose `serverId` is not in this list will be rejected.
   */
  allowedClusters: z.array(z.string().min(1)).default([]),
  /**
   * How long (ms) to wait without a CLUSTER_HEARTBEAT before declaring a
   * Cluster Server dead and hiding it from the server list.
   * Should be at least 2* the cluster's heartbeatIntervalMs.
   */
  heartbeatTimeoutMs: z.number().int().min(5000).default(15000),
});

// ---------------------------------------------------------------------------
// Login server schema
// ---------------------------------------------------------------------------

/**
 * Full configuration schema for the Login Server.
 *
 * @example
 * ```ts
 * import { loadConfig } from '@flyff/core/config';
 * import { LoginServerConfigSchema } from '@flyff/core/config/schemas/login.js';
 *
 * const config = loadConfig('login-server', LoginServerConfigSchema);
 * ```
 */
export const LoginServerConfigSchema = BaseConfigSchema.merge(
  z.object({
    auth: AuthConfigSchema.default({}),
    /**
     * Static fallback cluster list used when no cluster has dynamically
     * registered yet. Once a cluster registers, dynamic entries take over.
     * May be an empty array if the operator prefers fully dynamic registration.
     */
    serverList: z.array(ClusterEntrySchema).default([]),
    registration: LoginRegistrationConfigSchema.default({}),
  }),
);

/** Inferred TypeScript type for the Login Server config. */
export type LoginServerConfig = z.infer<typeof LoginServerConfigSchema>;

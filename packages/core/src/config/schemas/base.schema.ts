/**
 * Base Zod configuration schema — shared by ALL servers.
 *
 * Every server-specific schema extends this via `BaseConfigSchema.merge(...)`.
 * Fields that are secret / environment-specific (passwords, IPC_SECRET) are
 * loaded from `process.env` at the highest priority in the ConfigLoader, so
 * they should never appear in committed config files.
 *
 * @module config/schemas/base
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

/** TCP listen address for the public game port. */
export const ServerNetworkSchema = z.object({
  /** Human-readable server identifier, used in IPC envelopes. */
  id: z.string().min(1),
  /** Address to bind the TCP listener on. */
  host: z.string().default('0.0.0.0'),
  /**
   * Public IP advertised to clients via the server/channel list (what they
   * connect TO). Must differ from `host` when binding 0.0.0.0 — advertising
   * 0.0.0.0 makes the client dial an unreachable target after login.
   */
  publicHost: z.string().default('127.0.0.1'),
  /** Public TCP port clients connect to. */
  port: z.number().int().min(1).max(65535),
});

/** Pino logger configuration. */
export const LogConfigSchema = z.object({
  /** Pino log level. */
  level: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
    .default('info'),
  /** Enable pino-pretty for human-readable output in dev. */
  pretty: z.boolean().default(false),
});

/** Knex database connection configuration. */
export const DatabaseConfigSchema = z.object({
  /** Knex client adapter. better-sqlite3 is the local-dev default (synchronous, prebuilt). */
  client: z.enum(['better-sqlite3', 'pg', 'mysql2']).default('better-sqlite3'),
  /** SQLite3 database file path (better-sqlite3 adapter only). */
  filename: z.string().default('./data/flyff_dev.sqlite3'),
  /**
   * PostgreSQL / MySQL connection URL (pg / mysql2 adapters).
   * Leave empty for SQLite.
   * **LOAD FROM ENV — never commit to config files.**
   */
  url: z.string().default(''),
  /** Knex connection pool sizes. */
  pool: z
    .object({
      min: z.number().int().min(0).default(1),
      max: z.number().int().min(1).default(10),
    })
    .default({}),
});

/** ICacheAdapter selection and Redis connection. */
export const CacheConfigSchema = z.object({
  /** Cache backend to use. Falls back to 'memory' if Redis is unreachable. */
  adapter: z.enum(['redis', 'memory', 'cloudflare']).default('memory'),
  /**
   * Redis connection URL.
   * **LOAD FROM ENV — never commit credentials to config files.**
   */
  redisUrl: z.string().default('redis://localhost:6379'),
});

/** Inter-server IPC settings. */
export const IpcConfigSchema = z.object({
  /**
   * HMAC-SHA256 shared secret for signing all IPC messages.
   * **MUST be loaded from `process.env.IPC_SECRET` — never committed.**
   */
  secret: z.string().min(16),
  /** Internal TLS TCP port this server binds (if it acts as an IpcServer). */
  internalPort: z.number().int().min(1024).max(65535).default(29000),
});

// ---------------------------------------------------------------------------
// Base schema (assembled)
// ---------------------------------------------------------------------------

/**
 * Base configuration schema shared by all Flyff servers.
 * Server-specific schemas extend this with `.merge()`.
 */
export const BaseConfigSchema = z.object({
  server: ServerNetworkSchema,
  log: LogConfigSchema.default({}),
  database: DatabaseConfigSchema.default({}),
  cache: CacheConfigSchema.default({}),
  ipc: IpcConfigSchema,
});

/** Inferred TypeScript type for the base config. */
export type BaseConfig = z.infer<typeof BaseConfigSchema>;

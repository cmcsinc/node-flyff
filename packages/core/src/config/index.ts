/**
 * @flyff/core -- Config subsystem public API.
 *
 * ## Usage
 * ```ts
 * import { loadConfig } from '@flyff/core/config';
 * import { WorldServerConfigSchema } from '@flyff/core/config/schemas/world.js';
 *
 * const config = await loadConfig('world-server', WorldServerConfigSchema);
 * ```
 *
 * ## What lives here
 * - {@link loadConfig} / {@link loadConfigSync} -- config file loader + env merge
 * - Zod schemas for every server type
 * - TypeScript inferred config types
 *
 * @module config
 */

// Loader
export { loadConfig, loadConfigSync } from './loader.js';
export type { LoadConfigOptions } from './loader.js';

// Base schema + types
export { BaseConfigSchema } from './schemas/base.schema.js';
export type { BaseConfig } from './schemas/base.schema.js';

// Server-specific schemas + types
export { LoginServerConfigSchema, ClusterEntrySchema } from './schemas/login.schema.js';
export type { LoginServerConfig } from './schemas/login.schema.js';

export { ClusterServerConfigSchema } from './schemas/cluster.schema.js';
export type { ClusterServerConfig } from './schemas/cluster.schema.js';

export { WorldServerConfigSchema } from './schemas/world.schema.js';
export type { WorldServerConfig } from './schemas/world.schema.js';

// Utility
export { deepMerge } from './merge.js';

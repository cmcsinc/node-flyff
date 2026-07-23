/**
 * @flyff/core -- Config subsystem public API.
 *
 * ## Usage
 * ```ts
 * import { loadConfig } from '@flyff/core/config';
 * import { WorldServerConfigSchema } from '@flyff/core/config/schemas/world';
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
export { loadConfig, loadConfigSync } from './loader';
export type { LoadConfigOptions } from './loader';

// Base schema + types
export { BaseConfigSchema } from './schemas/base.schema';
export type { BaseConfig } from './schemas/base.schema';

// Server-specific schemas + types
export { LoginServerConfigSchema, ClusterEntrySchema } from './schemas/login.schema';
export type { LoginServerConfig } from './schemas/login.schema';

export { ClusterServerConfigSchema } from './schemas/cluster.schema';
export type { ClusterServerConfig } from './schemas/cluster.schema';

export { WorldServerConfigSchema } from './schemas/world.schema';
export type { WorldServerConfig } from './schemas/world.schema';

// Utility
export { deepMerge } from './merge';

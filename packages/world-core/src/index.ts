/**
 * @flyff/world-core -- shared world layer consumed by every world-server
 * domain package: the in-memory managers (Player/Zone/Spawn) + the QuestHooks
 * seam. Depends on `@flyff/entities`, `@flyff/core`, `@flyff/resources`.
 *
 * @module @flyff/world-core
 */

export { PlayerManager } from './managers/player.manager';
export { ZoneManager } from './managers/zone.manager';
export { SpawnManager } from './managers/spawn.manager';

export type { QuestHooks } from './quest-hooks';

/**
 * @flyff/world-core -- shared world layer consumed by every world-server
 * domain package: the in-memory managers (Player/Zone/Spawn) + the QuestHooks
 * seam. Depends on `@flyff/entities`, `@flyff/core`, `@flyff/resources`.
 *
 * @module @flyff/world-core
 */

export { PlayerManager } from './managers/player.manager';
export { ZoneManager } from './managers/zone.manager';
export { SpawnManager, CORPSE_DESPAWN_MS } from './managers/spawn.manager';

export type { QuestHooks } from './quest-hooks';

// Protocol opcodes + serializer constants (SNAPSHOTTYPE_*/OT_*/METHOD_*/MI_*/...).
// Moved here from world-server so every domain package's serializers can share
// them without depending on world-server. Slot-sizing consts are re-exported
// through here from @flyff/entities for legacy importers.
export * from './snapshot-constants';

// Shared S->C serializers consumed by 2+ domain packages (kept here so neither
// domain depends on the other). Currently: doUseSkillPoint (combat + skills).
export * from './serializers/doUseSkillPoint.serializer';
export * from './serializers/itemElemBody.serializer';
export * from './serializers/pointParam.serializer';
export * from './serializers/skillState.serializer';
export * from './serializers/chat.serializer';
export * from './serializers/itemContainer';
export * from './serializers/actionSlot.serializer';
export * from './serializers/duel.serializer';

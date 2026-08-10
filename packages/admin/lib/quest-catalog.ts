/**
 * Server-side quest catalog resolver.
 *
 * Provides access to quest definitions + the lookups the admin quest UI needs:
 * `IDS_PROPQUEST_INC_*` display text, item names + icons, mover names, and NPC
 * display names / world placements. Backed by the process-wide cache in
 * `lib/resource-cache.ts` (loaded once at server boot, not per request).
 *
 * NPC naming follows the C++ chain (`Project.cpp:3023` -> `Mover.cpp:1011`):
 * character.inc `SetName(IDS_*)` resolved through `character.txt.txt`. The
 * propMover name is the shared *model* name and is wrong for NPCs, so it is only
 * used for monsters.
 *
 * @module lib/quest-catalog
 */

import { npcNameForKey, type QuestDef, type QuestCommand, type QuestState } from '@flyff/resources';
import { getResourceIndex as getCatalog } from './resource-cache';

/** A resolved world position for an NPC or monster. */
export interface Placement {
  x: number;
  z: number;
  /** Zone id string (e.g. `flaris`), when the placement came from zone data. */
  zone?: string;
}

/** Look up a quest definition by numeric id. */
export async function getQuest(questId: number): Promise<QuestDef | undefined> {
  const res = await getCatalog();
  return res.quests.byId.get(questId);
}

/** Resolve an IDS_PROPQUEST_INC_* token to display text. Empty string when absent. */
export async function resolveQuestText(token: string | undefined): Promise<string> {
  if (!token) return '';
  const res = await getCatalog();
  return res.questText.get(token) ?? '';
}

/** Item name + icon URL for a propItem id. */
export async function resolveItem(itemId: number): Promise<{ name: string; iconUrl: string }> {
  const res = await getCatalog();
  const def = res.items.items.get(itemId);
  return {
    name: def?.name ?? `Item #${String(itemId)}`,
    iconUrl: def?.icon
      ? `/icons/${def.icon.replace(/\.dds$/i, '.png')}`
      : '/icons/_placeholder.svg',
  };
}

/** Mover (monster) name for an MI_* numeric id. */
export async function resolveMoverName(moverId: number): Promise<string> {
  const res = await getCatalog();
  return res.movers.movers.get(moverId)?.name ?? `Monster #${String(moverId)}`;
}

/**
 * NPC display name for a character.inc key. Falls back to a de-prefixed,
 * space-separated form of the key (`MaFl_SsoTta` -> `SsoTta`) when the string
 * table has no entry — never the propMover model name, which would be wrong.
 */
export async function resolveNpcName(charKey: string): Promise<string> {
  const res = await getCatalog();
  const name = npcNameForKey(res.characterInc, charKey);
  if (name) return name;
  // Strip the `XxYy_` region prefix; keeps the key readable without lying.
  return charKey.replace(/^[A-Za-z]{2,4}_/, '') || charKey;
}

/**
 * Find an NPC's world placement by character.inc key, scanning zone NPC lists.
 * Only Flaris is extracted today, so most quest NPCs return `undefined` — the
 * caller should prefer the coordinates embedded in the quest command args.
 */
export async function resolveNpcPlacement(charKey: string): Promise<Placement | undefined> {
  const res = await getCatalog();
  for (const zone of res.zones.zones.values()) {
    for (const npc of zone.npcs) {
      if (npc.character_key === charKey) {
        return { x: npc.position.x, z: npc.position.z, zone: zone._id };
      }
    }
  }
  return undefined;
}

/**
 * Find a monster's spawn placement by MI_* id, scanning zone spawn lists.
 * Returns the first match — monsters spawn in many places, this is indicative.
 */
export async function resolveMoverPlacement(moverId: number): Promise<Placement | undefined> {
  const res = await getCatalog();
  for (const zone of res.zones.zones.values()) {
    for (const spawn of zone.spawns) {
      if (spawn.mover_id === moverId) {
        return { x: spawn.position.x, z: spawn.position.z, zone: zone._id };
      }
    }
  }
  return undefined;
}

// Re-export types for convenience.
export type { QuestDef, QuestCommand, QuestState };

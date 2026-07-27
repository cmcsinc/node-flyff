/**
 * @flyff/resources
 *
 * Resource loaders for Flyff emulator data.
 *
 * Loads and validates YAML resource files (items, movers, skills, zones).
 *
 * @example
 * ```ts
 * import { loadAllResources } from '@flyff/resources';
 *
 * const resources = await loadAllResources('./resources/data');
 * const sword = resources.items.items.get(1);
 * console.log(sword.name); // "Sword"
 * ```
 *
 * @module index
 */

import { resolve } from 'node:path';
import { createResourceLogger } from './logger';

// Loaders
import { loadItems, type ItemIndex } from './loaders/item.loader';
import { loadMovers, type MoverIndex } from './loaders/mover.loader';
import { loadSkills, type SkillIndex } from './loaders/skill.loader';
import { loadZones, type ZoneIndex } from './loaders/zone.loader';
import { loadDialogs, type DialogIndex } from './loaders/dialog.loader';
import { loadQuests, type QuestIndex } from './loaders/quest.loader';
import { loadDrops, type DropIndex } from './loaders/drop.loader';
import { loadCharacterInc, type CharacterIncIndex } from './loaders/characterInc.loader';
import { loadSetItems, type SetItemIndex } from './loaders/setItem.loader';
import { loadDefines } from './loaders/defines.loader';
import { loadQuestText, type QuestTextIndex } from './loaders/questText.loader';

const logger = createResourceLogger('resources');

/**
 * Complete resource index.
 *
 * Contains all loaded game data.
 */
export interface ResourceIndex {
  /** Item definitions */
  items: ItemIndex;

  /** Mover definitions (NPCs, monsters, pets) */
  movers: MoverIndex;

  /** Skill definitions */
  skills: SkillIndex;

  /** Zone definitions */
  zones: ZoneIndex;

  /** NPC dialog definitions */
  dialogs: DialogIndex;

  /** Quest definitions */
  quests: QuestIndex;

  /** Drop tables (propMoverEx.inc) -- keyed by mover model index. */
  drops: DropIndex;

  /** character.inc NPC outfits + AddMenu capability + dialog file. */
  characterInc: CharacterIncIndex;

  /** Set-item definitions (propItemEtc.inc `SetItem` blocks) keyed by id + item id. */
  setItems: SetItemIndex;

  /** `#define` symbol table from `raw/define*.h` -- resolves `QUEST_*` / `II_*`
   *  / `MI_*` / `JOB_*` tokens in dialog source bodies + quest commands. */
  defines: Map<string, number>;

  /** `IDS_PROPQUEST_INC_* -> display text` from `raw/propQuest.txt.txt`.
   *  Resolves quest titles + per-state desc/cond/status for the dialog UI. */
  questText: QuestTextIndex;
}

/**
 * Loads all resources from the data directory.
 *
 * This function parses and validates all YAML resource files.
 * It throws if any file fails validation.
 *
 * @param dataDir  - Path to resources/data directory
 * @param rawDir   - Path to resources/raw directory (character.inc source). Defaults to `<dataDir>/../raw`.
 * @returns Complete resource index
 */
export async function loadAllResources(
  dataDir: string = './resources/data',
  rawDir: string = resolve(dataDir, '..', 'raw'),
): Promise<ResourceIndex> {
  logger.info({ dataDir, rawDir }, 'Loading all resources...');

  const [items, movers, skills, zones, dialogs, quests, drops, characterInc, setItems, defines, questText] = await Promise.all([
    loadItems(dataDir, rawDir),
    loadMovers(dataDir),
    loadSkills(dataDir),
    loadZones(dataDir),
    loadDialogs(dataDir),
    loadQuests(dataDir),
    loadDrops(dataDir),
    loadCharacterInc(rawDir),
    loadSetItems(dataDir),
    loadDefines(rawDir),
    loadQuestText(rawDir),
  ]);

  logger.info(
    {
      items: items.items.size,
      movers: movers.movers.size,
      skills: skills.skills.size,
      zones: zones.zones.size,
      dialogs: dialogs.byPrefix.size,
      quests: quests.byId.size,
      drops: drops.drops.size,
      characterInc: characterInc.byKey.size,
      setItems: setItems.byId.size,
      defines: defines.size,
      questText: questText.size,
    },
    'All resources loaded'
  );

  return { items, movers, skills, zones, dialogs, quests, drops, characterInc, setItems, defines, questText };
}

/**
 * Singleton cached resources.
 *
 * Use this for production to avoid reloading on every request.
 */
let cachedResources: ResourceIndex | null = null;

/**
 * Gets cached resources or loads them if not cached.
 *
 * @param dataDir - Path to resources/data directory
 * @returns Resource index (cached)
 */
export async function getResources(
  dataDir: string = './resources/data'
): Promise<ResourceIndex> {
  if (!cachedResources) {
    cachedResources = await loadAllResources(dataDir);
  }
  return cachedResources;
}

/**
 * Clears the resource cache.
 *
 * Call this before hot-reloading in development.
 */
export function clearResourceCache(): void {
  cachedResources = null;
  logger.debug('Resource cache cleared');
}

/**
 * Reloads all resources (for development hot-reload).
 *
 * @param dataDir - Path to resources/data directory
 * @returns Freshly loaded resource index
 */
export async function reloadResources(
  dataDir: string = './resources/data'
): Promise<ResourceIndex> {
  logger.info('Reloading resources...');
  clearResourceCache();
  return await getResources(dataDir);
}

// Re-export types for convenience
export type { ItemDefinition } from './schemas/item.schema';
export type { MoverDefinition } from './schemas/mover.schema';
export type { SkillDefinition, SkillLevel } from './schemas/skill.schema';
export { loadSkills, type SkillIndex } from './loaders/skill.loader';
export type { ZoneDefinition } from './schemas/zone.schema';
export type { DialogFile, DialogState, DialogKey } from './schemas/dialog.schema';
export type { QuestDef, QuestCommand, QuestArg, QuestItem, QuestState } from './schemas/quest.schema';
export type { DropTable, DropItem } from './schemas/drop.schema';
export {
  loadDialogs,
  prefixForNpc,
  stateForKey,
  dialogText,
  type DialogIndex,
} from './loaders/dialog.loader';
export {
  loadQuests,
  questById,
  dropsFor,
  type QuestIndex,
  type QuestsByNpc,
  type QuestDrop,
} from './loaders/quest.loader';
export { loadDefines } from './loaders/defines.loader';
export { loadQuestText, type QuestTextIndex } from './loaders/questText.loader';
export {
  loadCharacterInc,
  parseCharacterInc,
  blockForMover,
  MMI_DIALOG,
  MMI_TRADE,
  MMI_NPC_BUFF,
  type CharacterIncIndex,
  type CharacterIncBlock,
  type CharacterIncOutfit,
  type CharacterIncEquipPart,
  type CharacterIncVendorTab,
  type CharacterIncVendorItem,
  type CharacterIncVendorItemId,
  type NpcBuffSkillEntry,
} from './loaders/characterInc.loader';
export {
  loadSetItems,
  type SetItemIndex,
  type SetItemDef,
  type SetItemElem,
  type SetItemAvail,
} from './loaders/setItem.loader';

// Re-export schemas
export * from './schemas/index';

// Re-export validators
export * from './validators/index';

// Re-export hot-reload
export * from './hotReload';

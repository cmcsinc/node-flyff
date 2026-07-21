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

import pino from 'pino';

// Loaders
import { loadItems, type ItemIndex } from './loaders/item.loader.js';
import { loadMovers, type MoverIndex } from './loaders/mover.loader.js';
import { loadSkills, type SkillIndex } from './loaders/skill.loader.js';
import { loadZones, type ZoneIndex } from './loaders/zone.loader.js';
import { loadDialogs, type DialogIndex } from './loaders/dialog.loader.js';
import { loadQuests, type QuestIndex } from './loaders/quest.loader.js';

const logger = pino({ name: '@flyff/resources' });

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
}

/**
 * Loads all resources from the data directory.
 *
 * This function parses and validates all YAML resource files.
 * It throws if any file fails validation.
 *
 * @param dataDir - Path to resources/data directory
 * @returns Complete resource index
 */
export async function loadAllResources(
  dataDir: string = './resources/data'
): Promise<ResourceIndex> {
  logger.info({ dataDir }, 'Loading all resources...');

  const [items, movers, skills, zones, dialogs, quests] = await Promise.all([
    loadItems(dataDir),
    loadMovers(dataDir),
    loadSkills(dataDir),
    loadZones(dataDir),
    loadDialogs(dataDir),
    loadQuests(dataDir),
  ]);

  logger.info(
    {
      items: items.items.size,
      movers: movers.movers.size,
      skills: skills.skills.size,
      zones: zones.zones.size,
      dialogs: dialogs.byPrefix.size,
      quests: quests.byId.size,
    },
    'All resources loaded'
  );

  return { items, movers, skills, zones, dialogs, quests };
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
export type { ItemDefinition } from './schemas/item.schema.js';
export type { MoverDefinition } from './schemas/mover.schema.js';
export type { SkillDefinition } from './schemas/skill.schema.js';
export type { ZoneDefinition } from './schemas/zone.schema.js';
export type { DialogFile, DialogState, DialogKey } from './schemas/dialog.schema.js';
export type { QuestDef, QuestCommand, QuestArg, QuestItem, QuestState } from './schemas/quest.schema.js';
export {
  loadDialogs,
  prefixForNpc,
  stateForKey,
  dialogText,
  type DialogIndex,
} from './loaders/dialog.loader.js';
export {
  loadQuests,
  questById,
  dropsFor,
  type QuestIndex,
} from './loaders/quest.loader.js';

// Re-export schemas
export * from './schemas/index.js';

// Re-export validators
export * from './validators/index.js';

// Re-export hot-reload
export * from './hotReload.js';

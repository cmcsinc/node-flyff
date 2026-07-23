/**
 * Quest resource loader.
 *
 * Loads the per-quest YAML files emitted by `scripts/converters/quests.ts` and
 * builds the lookup tables the runtime needs:
 *  - `byId`     -- numeric quest id -> definition (the condition/reward engine)
 *  - `drops`    -- monster MI_* -> quest-item generators (the drop system)
 *
 * @module loaders/quest
 */

import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { createResourceLogger } from '../logger';
import {
  QuestDefSchema,
  QuestIndexSchema,
  type QuestDef,
  type QuestItem,
} from '../schemas/quest.schema';

const logger = createResourceLogger('quest.loader');

/**
 * A `QuestItem` drop generator enriched with the owning quest id.
 *
 * The persisted yml `quest_items` rows don't carry their quest id (they live
 * inside the quest file), but the drop system must know which quest a generator
 * belongs to so it only fires for players with that quest active. The loader
 * stamps `questId` while aggregating.
 */
export interface QuestDrop extends QuestItem {
  questId: number;
}

export interface QuestIndex {
  /** Quest id -> definition. */
  byId: Map<number, QuestDef>;
  /** Monster MI_* -> quest items that monster drops (aggregated across quests). */
  drops: Map<number, QuestDrop[]>;
}

/** Look up a quest definition by numeric id. */
export function questById(index: QuestIndex, id: number): QuestDef | undefined {
  return index.byId.get(id);
}

/** All quest-item generators for a slain monster (may belong to several quests). */
export function dropsFor(index: QuestIndex, moverId: number): QuestDrop[] {
  return index.drops.get(moverId) ?? [];
}

export async function loadQuests(dataDir: string): Promise<QuestIndex> {
  const dir = resolve(dataDir, 'quests');
  logger.info({ dir }, 'Loading quests...');

  const indexFile = parse(await readFile(resolve(dir, '_index.yml'), 'utf-8'));
  const indexRow = QuestIndexSchema.parse(indexFile);

  const byId = new Map<number, QuestDef>();
  const files = (await readdir(dir)).filter((f) => /^\d+\.yml$/.test(f));
  let drops = 0;
  for (const file of files) {
    try {
      const def = QuestDefSchema.parse(parse(await readFile(resolve(dir, file), 'utf-8')));
      byId.set(def.id, def);
    } catch (err) {
      logger.warn({ file, err: (err as Error).message }, 'Failed to validate quest file');
    }
  }

  // Aggregate quest-item drops by monster, stamped with the owning quest id.
  const dropsMap = new Map<number, QuestDrop[]>();
  for (const def of byId.values()) {
    for (const qi of def.quest_items) {
      const drop: QuestDrop = { ...qi, questId: def.id };
      const list = dropsMap.get(qi.mover);
      if (list) list.push(drop);
      else dropsMap.set(qi.mover, [drop]);
      drops++;
    }
  }

  logger.info(
    { quests: byId.size, indexed: indexRow.quests.length, dropGens: drops },
    'Quests loaded',
  );
  return { byId, drops: dropsMap };
}

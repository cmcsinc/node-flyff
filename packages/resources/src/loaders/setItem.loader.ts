/**
 * Set-item loader -- reads `data/set-items/set-items.yml` into a lookup index.
 *
 * Two maps: by set `id` and by constituent item id. The constituent map backs
 * the equip/unequip recompute in `EquipService`/`JoinService` -- given an
 * equipped itemId, O(1) "which set does this belong to?". All `II_*`/`PARTS_*`
 * /`DST_*` symbols are pre-resolved to numerics by the converter at
 * `scripts/converters/setItems.ts`; the loader only validates + indexes.
 *
 * @module loaders/setItem
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { createResourceLogger } from '../logger';
import {
  SetItemFileSchema,
  type SetItemDef,
  type SetItemElem,
  type SetItemAvail,
} from '../schemas/setItem.schema';

const logger = createResourceLogger('setItem.loader');

/** Lookup index -- by set id and by any constituent item id. */
export interface SetItemIndex {
  readonly byId: Map<number, SetItemDef>;
  readonly byItemId: Map<number, SetItemDef>;
}

// Re-export the schema types so existing import sites (`from '@flyff/resources'`)
// keep resolving after the loader moved to a YAML-backed model.
export type { SetItemDef, SetItemElem, SetItemAvail };

/**
 * Load set items from `dataDir/set-items/set-items.yml`.
 * Missing file -> empty index (set bonuses disabled; servers still boot).
 */
export async function loadSetItems(dataDir: string): Promise<SetItemIndex> {
  const filePath = resolve(dataDir, 'set-items', 'set-items.yml');
  const byId = new Map<number, SetItemDef>();
  const byItemId = new Map<number, SetItemDef>();

  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch {
    logger.warn({ filePath }, 'No set-items.yml found -- set bonuses disabled');
    return { byId, byItemId };
  }

  const validated = SetItemFileSchema.parse(parse(content));
  for (const def of validated.sets) {
    byId.set(def.id, def);
    for (const e of def.elems) byItemId.set(e.itemId, def);
  }

  logger.info({ sets: byId.size, items: byItemId.size }, 'Set items loaded');
  return { byId, byItemId };
}

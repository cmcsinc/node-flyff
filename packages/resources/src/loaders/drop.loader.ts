/**
 * Drop table loader -- reads `data/drops/drops.yml` into a model-index index.
 *
 * Keyed by `modelIdx` (== `CMover.m_dwIndex`) so the death roll is an O(1)
 * lookup. Slots carry a percent `chance`; there is no probability scale to
 * re-export any more (see `schemas/drop.schema.ts` for why the raw DWORD went
 * away).
 *
 * @module loaders/drop.loader
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { createResourceLogger } from '../logger';
import { DropFileSchema, type DropTable } from '../schemas/drop.schema';

const logger = createResourceLogger('drop.loader');

export interface DropIndex {
  /** modelIdx (== CMover.m_dwIndex) -> drop table. */
  drops: Map<number, DropTable>;
}

/**
 * Load all drop tables from `dataDir/drops/drops.yml`.
 * Missing file -> empty index (drops are optional; servers still boot).
 */
export async function loadDrops(dataDir: string): Promise<DropIndex> {
  const filePath = resolve(dataDir, 'drops', 'drops.yml');
  const drops = new Map<number, DropTable>();

  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch {
    logger.warn({ filePath }, 'No drops.yml found -- drops disabled');
    return { drops };
  }

  const validated = DropFileSchema.parse(parse(content));
  for (const t of validated.drops) drops.set(t.modelIdx, t);

  logger.info({ count: drops.size }, 'Drop tables loaded');
  return { drops };
}

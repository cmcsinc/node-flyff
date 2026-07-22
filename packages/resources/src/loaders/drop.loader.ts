/**
 * Drop table loader -- reads `data/drops/drops.yml` into a model-index index.
 *
 * Keyed by `modelIdx` (== `CMover.m_dwIndex`) so the death roll is an O(1)
 * lookup. The probability scale is read from the file's `_prob_scale` and
 * re-exported so the roll math and the data stay in sync.
 *
 * @module loaders/drop.loader
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { createResourceLogger } from '../logger.js';
import { DropFileSchema, type DropTable } from '../schemas/drop.schema.js';

const logger = createResourceLogger('drop.loader');

export interface DropIndex {
  /** modelIdx (== CMover.m_dwIndex) -> drop table. */
  drops: Map<number, DropTable>;
  /** Probability denominator from the file (`_prob_scale`). */
  probScale: number;
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
    return { drops, probScale: 3_000_000_000 };
  }

  const validated = DropFileSchema.parse(parse(content));
  for (const t of validated.drops) drops.set(t.modelIdx, t);

  logger.info({ count: drops.size }, 'Drop tables loaded');
  return { drops, probScale: validated._prob_scale };
}

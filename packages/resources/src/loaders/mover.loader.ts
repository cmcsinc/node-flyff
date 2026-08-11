/**
 * Mover resource loader.
 *
 * Loads and indexes mover definitions (NPCs, monsters, pets) from YAML files.
 *
 * @module loaders/mover.loader
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readdir } from 'node:fs/promises';
import { parse } from 'yaml';
import { createResourceLogger } from '../logger';
import {
  MoverFileSchema,
  MoverIndexSchema,
} from '../schemas/mover.schema';
import type { MoverDefinition } from '../schemas/mover.schema';

const logger = createResourceLogger('mover.loader');

/** Appends `mover` to the bucket keyed by `key`, creating the bucket if absent. */
function pushBucket(
  map: Map<string, MoverDefinition[]>,
  key: string,
  mover: MoverDefinition
): void {
  const bucket = map.get(key);
  if (bucket === undefined) {
    map.set(key, [mover]);
    return;
  }
  bucket.push(mover);
}

/**
 * Loaded mover index structure.
 */
export interface MoverIndex {
  /** Map of mover ID -> definition */
  movers: Map<number, MoverDefinition>;

  /** Map of mover name -> definition */
  byName: Map<string, MoverDefinition>;

  /** Map of type -> array of definitions */
  byType: Map<string, MoverDefinition[]>;
}

/**
 * Loads all movers from the movers directory.
 *
 * @param dataDir - Root resources/data directory
 * @returns Mover index
 */
export async function loadMovers(dataDir: string): Promise<MoverIndex> {
  const moversDir = resolve(dataDir, 'movers');
  const indexPath = resolve(moversDir, '_index.yml');

  logger.info({ moversDir }, 'Loading movers...');

  // Check if index exists
  try {
    await readFile(indexPath, 'utf-8');
  } catch {
    logger.warn('No _index.yml found, loading all .yml files');
    return await loadMoversWithoutIndex(moversDir);
  }

  // Load index
  const indexContent = await readFile(indexPath, 'utf-8');
  const indexData: unknown = parse(indexContent);
  const index = MoverIndexSchema.parse(indexData);

  const movers = new Map<number, MoverDefinition>();
  const byName = new Map<string, MoverDefinition>();
  const byType = new Map<string, MoverDefinition[]>();

  // Track loaded files
  const loadedFiles = new Set<string>();

  for (const entry of Object.values(index)) {
    const file = entry.file;
    const filePath = resolve(moversDir, file);

    if (loadedFiles.has(filePath)) continue;
    loadedFiles.add(filePath);

    try {
      const content = await readFile(filePath, 'utf-8');
      const data: unknown = parse(content);
      const validated = MoverFileSchema.parse(data);

      for (const mover of validated.movers) {
        movers.set(mover.id, mover);
        byName.set(mover.name, mover);

        pushBucket(byType, mover.type ?? 'unknown', mover);
      }

      logger.debug({ file, count: validated.movers.length }, 'Loaded mover file');
    } catch (err) {
      logger.error({ file, err }, 'Failed to load mover file');
      throw err;
    }
  }

  logger.info({ count: movers.size }, 'Movers loaded');

  return { movers, byName, byType };
}

/**
 * Loads movers without an index file.
 *
 * @param moversDir - Movers directory path
 * @returns Mover index
 */
async function loadMoversWithoutIndex(
  moversDir: string
): Promise<MoverIndex> {
  const files = await readdir(moversDir);
  const ymlFiles = files.filter((f) => f.endsWith('.yml') && f !== '_index.yml');

  const movers = new Map<number, MoverDefinition>();
  const byName = new Map<string, MoverDefinition>();
  const byType = new Map<string, MoverDefinition[]>();

  for (const file of ymlFiles) {
    const filePath = resolve(moversDir, file);

    try {
      const content = await readFile(filePath, 'utf-8');
      const data: unknown = parse(content);
      const validated = MoverFileSchema.parse(data);

      for (const mover of validated.movers) {
        movers.set(mover.id, mover);
        byName.set(mover.name, mover);

        pushBucket(byType, mover.type ?? 'unknown', mover);
      }

      logger.debug({ file, count: validated.movers.length }, 'Loaded mover file');
    } catch (err) {
      logger.error({ file, err }, 'Failed to load mover file');
      throw err;
    }
  }

  logger.info({ count: movers.size }, 'Movers loaded (without index)');

  return { movers, byName, byType };
}

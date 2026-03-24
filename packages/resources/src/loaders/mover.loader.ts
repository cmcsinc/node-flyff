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
import pino from 'pino';
import {
  MoverDefinitionSchema,
  MoverFileSchema,
  MoverIndexSchema,
} from '../schemas/mover.schema.js';

const logger = pino({ name: 'mover.loader' });

/**
 * Loaded mover index structure.
 */
export interface MoverIndex {
  /** Map of mover ID → definition */
  movers: Map<number, import('../schemas/mover.schema.js').MoverDefinition>;

  /** Map of mover name → definition */
  byName: Map<string, import('../schemas/mover.schema.js').MoverDefinition>;

  /** Map of type → array of definitions */
  byType: Map<string, import('../schemas/mover.schema.js').MoverDefinition[]>;
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
  const indexData = parse(indexContent);
  const index = MoverIndexSchema.parse(indexData);

  const movers = new Map<number, import('../schemas/mover.schema.js').MoverDefinition>();
  const byName = new Map<string, import('../schemas/mover.schema.js').MoverDefinition>();
  const byType = new Map<string, import('../schemas/mover.schema.js').MoverDefinition[]>();

  // Track loaded files
  const loadedFiles = new Set<string>();

  for (const [idStr, entry] of Object.entries(index)) {
    const file = entry.file;
    const filePath = resolve(moversDir, file);

    if (loadedFiles.has(filePath)) continue;
    loadedFiles.add(filePath);

    try {
      const content = await readFile(filePath, 'utf-8');
      const data = parse(content);
      const validated = MoverFileSchema.parse(data);

      for (const mover of validated.movers) {
        movers.set(mover.id, mover);
        byName.set(mover.name, mover);

        const type = mover.type || 'unknown';
        if (!byType.has(type)) {
          byType.set(type, []);
        }
        byType.get(type)!.push(mover);
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

  const movers = new Map<number, import('../schemas/mover.schema.js').MoverDefinition>();
  const byName = new Map<string, import('../schemas/mover.schema.js').MoverDefinition>();
  const byType = new Map<string, import('../schemas/mover.schema.js').MoverDefinition[]>();

  for (const file of ymlFiles) {
    const filePath = resolve(moversDir, file);

    try {
      const content = await readFile(filePath, 'utf-8');
      const data = parse(content);
      const validated = MoverFileSchema.parse(data);

      for (const mover of validated.movers) {
        movers.set(mover.id, mover);
        byName.set(mover.name, mover);

        const type = mover.type || 'unknown';
        if (!byType.has(type)) {
          byType.set(type, []);
        }
        byType.get(type)!.push(mover);
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

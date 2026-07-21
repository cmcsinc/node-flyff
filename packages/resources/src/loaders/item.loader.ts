/**
 * Item resource loader.
 *
 * Loads and indexes item definitions from YAML files.
 *
 * @module loaders/item.loader
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readdir } from 'node:fs/promises';
import { parse } from 'yaml';
import { createResourceLogger } from '../logger.js';
import {
  ItemDefinitionSchema,
  ItemFileSchema,
  ItemIndexSchema,
} from '../schemas/item.schema.js';

const logger = createResourceLogger('item.loader');

/**
 * Loaded item index structure.
 */
export interface ItemIndex {
  /** Map of item ID → definition */
  items: Map<number, import('../schemas/item.schema.js').ItemDefinition>;

  /** Map of item name → definition */
  byName: Map<string, import('../schemas/item.schema.js').ItemDefinition>;

  /** Map of kind → array of definitions */
  byKind: Map<string, import('../schemas/item.schema.js').ItemDefinition[]>;
}

/**
 * Loads all items from the items directory.
 *
 * @param dataDir - Root resources/data directory
 * @returns Item index
 */
export async function loadItems(dataDir: string): Promise<ItemIndex> {
  const itemsDir = resolve(dataDir, 'items');
  const indexPath = resolve(itemsDir, '_index.yml');

  logger.info({ itemsDir }, 'Loading items...');

  // Check if index exists
  try {
    await readFile(indexPath, 'utf-8');
  } catch {
    logger.warn('No _index.yml found, loading all .yml files');
    return await loadItemsWithoutIndex(itemsDir);
  }

  // Load index
  const indexContent = await readFile(indexPath, 'utf-8');
  const indexData = parse(indexContent);
  const index = ItemIndexSchema.parse(indexData);

  const items = new Map<number, import('../schemas/item.schema.js').ItemDefinition>();
  const byName = new Map<string, import('../schemas/item.schema.js').ItemDefinition>();
  const byKind = new Map<string, import('../schemas/item.schema.js').ItemDefinition[]>();

  // Track loaded files to avoid duplicates
  const loadedFiles = new Set<string>();

  // Load each file referenced in index
  for (const [idStr, entry] of Object.entries(index)) {
    const id = parseInt(idStr, 10);
    const file = entry.file;
    const filePath = resolve(itemsDir, file);

    if (loadedFiles.has(filePath)) continue;
    loadedFiles.add(filePath);

    try {
      // Parse and validate
      const content = await readFile(filePath, 'utf-8');
      const data = parse(content);
      const validated = ItemFileSchema.parse(data);

      // Index items
      for (const item of validated.items) {
        items.set(item.id, item);
        byName.set(item.name, item);

        if (!byKind.has(validated._kind)) {
          byKind.set(validated._kind, []);
        }
        byKind.get(validated._kind)!.push(item);
      }

      logger.debug({ file, count: validated.items.length }, 'Loaded item file');
    } catch (err) {
      logger.error({ file, err }, 'Failed to load item file');
      throw err;
    }
  }

  logger.info({ count: items.size }, 'Items loaded');

  return { items, byName, byKind };
}

/**
 * Loads items without an index file (scans all .yml files).
 *
 * @param itemsDir - Items directory path
 * @returns Item index
 */
async function loadItemsWithoutIndex(
  itemsDir: string
): Promise<ItemIndex> {
  const files = await readdir(itemsDir);
  const ymlFiles = files.filter((f) => f.endsWith('.yml') && f !== '_index.yml');

  const items = new Map<number, import('../schemas/item.schema.js').ItemDefinition>();
  const byName = new Map<string, import('../schemas/item.schema.js').ItemDefinition>();
  const byKind = new Map<string, import('../schemas/item.schema.js').ItemDefinition[]>();

  for (const file of ymlFiles) {
    const filePath = resolve(itemsDir, file);

    try {
      const content = await readFile(filePath, 'utf-8');
      const data = parse(content);
      const validated = ItemFileSchema.parse(data);

      for (const item of validated.items) {
        items.set(item.id, item);
        byName.set(item.name, item);

        if (!byKind.has(validated._kind)) {
          byKind.set(validated._kind, []);
        }
        byKind.get(validated._kind)!.push(item);
      }

      logger.debug({ file, count: validated.items.length }, 'Loaded item file');
    } catch (err) {
      logger.error({ file, err }, 'Failed to load item file');
      throw err;
    }
  }

  logger.info({ count: items.size }, 'Items loaded (without index)');

  return { items, byName, byKind };
}

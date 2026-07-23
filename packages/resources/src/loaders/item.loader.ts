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
import { createResourceLogger } from '../logger';
import {
  ItemDefinitionSchema,
  ItemFileSchema,
  ItemIndexSchema,
} from '../schemas/item.schema';

const logger = createResourceLogger('item.loader');

/**
 * Loaded item index structure.
 */
export interface ItemIndex {
  /** Map of item ID -> definition */
  items: Map<number, import('../schemas/item.schema').ItemDefinition>;

  /** Map of item name -> definition */
  byName: Map<string, import('../schemas/item.schema').ItemDefinition>;

  /** Map of kind -> array of definitions */
  byKind: Map<string, import('../schemas/item.schema').ItemDefinition[]>;

  /**
   * Map of `item_kind3` symbol (IK3_*, e.g. `IK3_AXE`) -> definitions. Used by
   * the NPC shop stock resolver to expand `character.inc` `AddVendorItem(slot,
   * IK3_*, ...)` into concrete propItem ids. Items without `item_kind3` are
   * skipped. Symbol form (not numeric) so it matches `character.inc` verbatim
   * without a second `defineItemkind.h` parse.
   */
  byKind3: Map<string, import('../schemas/item.schema').ItemDefinition[]>;

  /**
   * Set of `II_*` numeric ids declared in `defineItem.h`. The client's
   * `GetItemProp(nIndex)` is a raw `m_aPropItem[nIndex]` array lookup, so any id
   * that is NOT a `#define II_* <n>` value is a null hole -> null prop ->
   * `CItemBase::SetTexture` null-deref crash. Shop stock (and any other server
   * -> client item id) MUST be filtered through this set before emission.
   */
  definedIds: Set<number>;
}

/**
 * Parse `#define II_* <n>` lines from `defineItem.h` (CRLF + UTF-16LE safe).
 * Missing file -> empty set (loader still boots).
 */
async function loadDefinedItemIds(rawDir: string): Promise<Set<number>> {
  let buf: Buffer;
  try {
    buf = await readFile(resolve(rawDir, 'defineItem.h'));
  } catch {
    logger.warn('defineItem.h not found -- item id whitelist empty');
    return new Set();
  }
  const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.subarray(2).toString('utf16le') : buf.toString('utf8');
  const ids = new Set<number>();
  for (const m of text.matchAll(/^\s*#define\s+II_\w+\s+(\d+)/gm)) {
    if (m[1]) ids.add(parseInt(m[1], 10));
  }
  logger.info({ count: ids.size }, 'defineItem.h II_* ids loaded');
  return ids;
}

/**
 * Loads all items from the items directory.
 *
 * @param dataDir  - Root resources/data directory
 * @param rawDir   - Raw resource directory (for `defineItem.h` id whitelist)
 * @returns Item index
 */
export async function loadItems(dataDir: string, rawDir: string): Promise<ItemIndex> {
  const itemsDir = resolve(dataDir, 'items');
  const indexPath = resolve(itemsDir, '_index.yml');

  logger.info({ itemsDir }, 'Loading items...');

  const definedIds = await loadDefinedItemIds(rawDir);

  // Check if index exists
  try {
    await readFile(indexPath, 'utf-8');
  } catch {
    logger.warn('No _index.yml found, loading all .yml files');
    const idx = await loadItemsWithoutIndex(itemsDir);
    idx.definedIds = definedIds;
    return idx;
  }

  // Load index
  const indexContent = await readFile(indexPath, 'utf-8');
  const indexData = parse(indexContent);
  const index = ItemIndexSchema.parse(indexData);

  const items = new Map<number, import('../schemas/item.schema').ItemDefinition>();
  const byName = new Map<string, import('../schemas/item.schema').ItemDefinition>();
  const byKind = new Map<string, import('../schemas/item.schema').ItemDefinition[]>();
  const byKind3 = new Map<string, import('../schemas/item.schema').ItemDefinition[]>();

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

        // NPC shop stock resolver groups by IK3 symbol (AddVendorItem expansion).
        if (item.item_kind3) {
          if (!byKind3.has(item.item_kind3)) byKind3.set(item.item_kind3, []);
          byKind3.get(item.item_kind3)!.push(item);
        }
      }

      logger.debug({ file, count: validated.items.length }, 'Loaded item file');
    } catch (err) {
      logger.error({ file, err }, 'Failed to load item file');
      throw err;
    }
  }

  logger.info({ count: items.size }, 'Items loaded');

  return { items, byName, byKind, byKind3, definedIds };
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

  const items = new Map<number, import('../schemas/item.schema').ItemDefinition>();
  const byName = new Map<string, import('../schemas/item.schema').ItemDefinition>();
  const byKind = new Map<string, import('../schemas/item.schema').ItemDefinition[]>();
  const byKind3 = new Map<string, import('../schemas/item.schema').ItemDefinition[]>();

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

        // NPC shop stock resolver groups by IK3 symbol (AddVendorItem expansion).
        if (item.item_kind3) {
          if (!byKind3.has(item.item_kind3)) byKind3.set(item.item_kind3, []);
          byKind3.get(item.item_kind3)!.push(item);
        }
      }

      logger.debug({ file, count: validated.items.length }, 'Loaded item file');
    } catch (err) {
      logger.error({ file, err }, 'Failed to load item file');
      throw err;
    }
  }

  logger.info({ count: items.size }, 'Items loaded (without index)');

  return { items, byName, byKind, byKind3, definedIds: new Set() };
}

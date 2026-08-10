/**
 * Resource browser/editor data access.
 *
 * All reads go through the process-wide cache in `lib/resource-cache.ts` — the
 * YAML directory is parsed once per server process, not once per request.
 *
 * @module lib/resources
 */

import { getYamlDir, invalidateResourceCache } from './resource-cache';

/** Resource type → directory under the resources data dir. Shared with the edit route. */
export const TYPE_DIRS: Record<string, string> = {
  items: 'items',
  movers: 'movers',
  skills: 'skills',
  quests: 'quests',
  drops: 'drops',
  dialogues: 'dialogues',
  'set-items': 'set-items',
  zones: 'worlds/zones',
};

function dirFor(type: string): string {
  const dir = TYPE_DIRS[type];
  if (!dir) throw new Error(`Unknown resource type: ${type}`);
  return dir;
}

/** All YAML docs for a resource type (no file paths). */
export function loadByType(type: string): Record<string, unknown>[] {
  return getYamlDir(dirFor(type)).map((d) => d.doc);
}

export const loadItems = (): Record<string, unknown>[] => loadByType('items');
export const loadMovers = (): Record<string, unknown>[] => loadByType('movers');
export const loadSkills = (): Record<string, unknown>[] => loadByType('skills');
export const loadQuests = (): Record<string, unknown>[] => loadByType('quests');
export const loadDrops = (): Record<string, unknown>[] => loadByType('drops');
export const loadZones = (): Record<string, unknown>[] => loadByType('zones');
export const loadSetItems = (): Record<string, unknown>[] => loadByType('set-items');
export const loadDialogues = (): Record<string, unknown>[] => loadByType('dialogues');

/** Collection keys that hold arrays of entries within a YAML file. */
const COLLECTION_KEYS = ['items', 'movers', 'skills', 'drops', 'sets', 'zones'] as const;

/**
 * Does this collection entry answer to `id`?
 *
 * Most collections key on a numeric `id`. Drop tables have none — a drop table
 * is identified by the `MI_*` mover symbol it hangs off (`key`), which is what
 * the browser page links to. Matching `id` first keeps the numeric path
 * unchanged for items/movers/skills, which also carry a `key`.
 */
export function entryMatches(entry: Record<string, unknown>, id: string): boolean {
  if (
    (typeof entry.id === 'string' || typeof entry.id === 'number') &&
    String(entry.id) === id
  )
    return true;
  return typeof entry.key === 'string' && entry.key === id;
}

/**
 * Find a single resource entry by id/type from the cached directory scan.
 * Used by both the edit page and the resource API route.
 */
export function loadEntryById(
  type: string,
  id: string,
): { file: string; entry: Record<string, unknown> } | null {
  for (const { file, doc } of getYamlDir(dirFor(type))) {
    for (const key of COLLECTION_KEYS) {
      const list = doc[key];
      if (Array.isArray(list)) {
        const found = list.find((e): e is Record<string, unknown> => {
          if (typeof e !== 'object' || e === null) return false;
          return entryMatches(e as Record<string, unknown>, id);
        });
        if (found) return { file, entry: found };
      }
    }
    if (String(doc.id) === id || String(doc._id_numeric) === id) return { file, entry: doc };
    if (doc.prefix === id) return { file, entry: doc };
  }
  return null;
}

export { invalidateResourceCache };

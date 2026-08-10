/**
 * Generic edit primitives for entries inside a zone YAML file.
 *
 * Zone files are not one resource — they are six collections (`spawns`, `npcs`,
 * `portals`, `regions`) plus zone-level scalars, all in one document. The
 * browser pages address an entry by the composite ref `<zoneId>:<entryId>`,
 * and every write goes through the yaml `Document` API rather than
 * `stringify(parse(file))`: `flaris.yml` carries hand-written header and region
 * comments (including the one warning that `extract:flaris` drops them) that a
 * whole-document re-serialize would delete.
 *
 * @module lib/zone-seq
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { parseDocument, isSeq, type Document, type YAMLSeq } from 'yaml';
import { getYamlDir, invalidateResourceCache } from './resource-cache';

export const ZONE_DIR = 'worlds/zones';

/** Zone identity for filter dropdowns. */
export interface ZoneRef {
  id: string;
  name: string;
}

/** One zone file, with the raw collections the edit pages read. */
export interface ZoneDoc {
  file: string;
  zoneId: string;
  zoneName: string;
  doc: Record<string, unknown>;
}

export function zoneDocs(): ZoneDoc[] {
  return getYamlDir(ZONE_DIR).map(({ file, doc }) => ({
    file,
    zoneId: typeof doc._id === 'string' ? doc._id : '',
    zoneName: typeof doc.name === 'string' ? doc.name : typeof doc._id === 'string' ? doc._id : '?',
    doc,
  }));
}

/** Entries of one collection in one zone file. */
export function zoneSeq(doc: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const list = doc[key];
  if (!Array.isArray(list)) return [];
  return list.filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null);
}

/** All zones that can hold entries. */
export function loadZoneRefs(): ZoneRef[] {
  return zoneDocs()
    .filter((z) => z.zoneId)
    .map((z) => ({ id: z.zoneId, name: z.zoneName }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** `"flaris:12"` → `{ zoneId: "flaris", entryId: 12 }`; `"flaris:new"` → `entryId: null`. */
export function parseZoneRef(ref: string): { zoneId: string; entryId: number | null } | null {
  const sep = ref.lastIndexOf(':');
  if (sep <= 0 || sep === ref.length - 1) return null;
  const zoneId = ref.slice(0, sep);
  const tail = ref.slice(sep + 1);
  if (tail === 'new') return { zoneId, entryId: null };
  const entryId = Number(tail);
  if (!Number.isInteger(entryId) || entryId <= 0) return null;
  return { zoneId, entryId };
}

/** Lowest unused positive id in a collection. */
export function nextEntryId(existing: readonly number[]): number {
  const used = new Set(existing);
  let id = 1;
  while (used.has(id)) id++;
  return id;
}

export function zoneFileFor(zoneId: string): string | null {
  return zoneDocs().find((z) => z.zoneId === zoneId)?.file ?? null;
}

/** Open one collection of a zone file, creating the node when absent. */
function openSeq(file: string, key: string): { doc: Document; seq: YAMLSeq } {
  const doc = parseDocument(readFileSync(file, 'utf-8'));
  let seq = doc.get(key);
  if (!isSeq(seq)) {
    doc.set(key, []);
    seq = doc.get(key);
  }
  if (!isSeq(seq)) throw new Error(`Zone file has an unusable ${key} node`);
  return { doc, seq };
}

function idOf(item: unknown): number {
  return Number((item as { get?: (k: string) => unknown }).get?.('id'));
}

function seqIds(seq: YAMLSeq): number[] {
  return seq.items.map(idOf).filter((n) => Number.isInteger(n));
}

/** Minimal schema surface — anything with a throwing `parse`. */
interface EntrySchema {
  parse: (value: unknown) => Record<string, unknown>;
}

/**
 * Create (`entryId === null`) or replace one entry in a zone collection.
 * Returns the written id. Exported for tests.
 *
 * Validated against the canonical schema before it lands: a bad placement or
 * spawn null-derefs the client's `OnAddObj`, so it must never reach disk.
 */
export function writeZoneEntryToFile(
  file: string,
  key: string,
  schema: EntrySchema,
  entryId: number | null,
  entry: Record<string, unknown>,
): number {
  const { doc, seq } = openSeq(file, key);
  const id = entryId ?? nextEntryId(seqIds(seq));
  const parsed = schema.parse({ ...entry, id });

  const idx = seq.items.findIndex((item) => idOf(item) === id);
  const node = doc.createNode(parsed);
  if (idx >= 0) seq.set(idx, node);
  else seq.add(node);

  writeFileSync(file, doc.toString({ lineWidth: 120 }), 'utf-8');
  return id;
}

/** Remove one entry from a zone collection. Exported for tests. */
export function deleteZoneEntryFromFile(file: string, key: string, entryId: number): boolean {
  const { doc, seq } = openSeq(file, key);
  const idx = seq.items.findIndex((item) => idOf(item) === entryId);
  if (idx < 0) return false;

  seq.delete(idx);
  writeFileSync(file, doc.toString({ lineWidth: 120 }), 'utf-8');
  return true;
}

/** Create or replace one entry in a zone, then drop the resource cache. */
export function saveZoneEntry(
  zoneId: string,
  key: string,
  schema: EntrySchema,
  entryId: number | null,
  entry: Record<string, unknown>,
): number {
  const file = zoneFileFor(zoneId);
  if (!file) throw new Error(`Unknown zone: ${zoneId}`);
  const id = writeZoneEntryToFile(file, key, schema, entryId, entry);
  invalidateResourceCache();
  return id;
}

/** Remove one entry. `false` when the zone or id does not exist. */
export function deleteZoneEntry(zoneId: string, key: string, entryId: number): boolean {
  const file = zoneFileFor(zoneId);
  if (!file) return false;
  if (!deleteZoneEntryFromFile(file, key, entryId)) return false;
  invalidateResourceCache();
  return true;
}

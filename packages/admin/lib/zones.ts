/**
 * Zone-level metadata browse/edit.
 *
 * A zone file holds two very different things: ~14 zone-level keys (identity,
 * bounds, revival, portals, regions, weather) and two huge placement collections
 * (`spawns:` 948 entries, `npcs:` 347 in `flaris.yml`). This module edits the
 * first group and **never touches the second** — placements have their own pages
 * (`lib/npcs.ts`, `lib/spawns.ts`) with their own per-entry validation.
 *
 * That split is why the write is key-by-key through the `Document` API rather
 * than a whole-doc replace. Re-serializing the document would:
 *
 * - rewrite 11 000 lines of placements the user did not edit, making every diff
 *   unreviewable, and
 * - delete the hand-written comments the file carries — including the one in
 *   `regions:` recording that the "Flaris Safe Zone" region was removed because
 *   it made every mushpang-field monster unkillable, and the warning that
 *   `pnpm extract:flaris` drops these notes.
 *
 * @module lib/zones
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { parseDocument } from 'yaml';
import { ZoneDefinitionSchema } from '@flyff/resources';
import { invalidateResourceCache } from './resource-cache';
import { zoneDocs, zoneFileFor, type ZoneDoc } from './zone-seq';

/**
 * The keys the zone form owns.
 *
 * `spawns`/`npcs` are deliberately absent — see the module note. `_version` is
 * schema bookkeeping the editor skips anyway.
 */
export const ZONE_META_KEYS = [
  '_id',
  '_id_numeric',
  'name',
  'name_id',
  'world_id',
  'bounds',
  'revival',
  'portals',
  'regions',
  'weather',
] as const;

/** One zone's metadata, with the placement collections stripped out. */
export function zoneMeta(doc: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ZONE_META_KEYS) {
    if (doc[key] !== undefined) out[key] = doc[key];
  }
  return out;
}

/** One zone file by its slug. */
export function findZone(zoneId: string): ZoneDoc | null {
  return zoneDocs().find((z) => z.zoneId === zoneId) ?? null;
}

/**
 * Rewrite only the metadata keys of a zone file. Returns nothing; throws on a
 * validation failure. Exported for tests; callers use `saveZoneMeta`.
 *
 * Validation runs against the **whole** `ZoneDefinitionSchema` with the on-disk
 * placements merged back in, not against the submitted subset: `bounds` that no
 * longer contain the spawns is still a valid zone document, and catching that is
 * not this function's job, but a `name_id` missing its `ZONE_` prefix or a
 * revival point with a zero radius must not reach disk. The parse result is
 * discarded — only the submitted values are written, so a schema `.default()`
 * never materializes a key the file did not have.
 */
export function writeZoneMetaToFile(file: string, meta: Record<string, unknown>): void {
  const doc = parseDocument(readFileSync(file, 'utf-8'));

  const submitted: Record<string, unknown> = {};
  for (const key of ZONE_META_KEYS) {
    if (meta[key] !== undefined) submitted[key] = meta[key];
  }

  // Merge over the current document so the schema sees a complete zone. The
  // parse result is a gate, not the payload: several nested schemas carry
  // `.default()`s, and writing the parsed object would inject keys the source
  // entry legitimately omits (rule 12 — absent keys stay absent).
  const current = doc.toJS() as Record<string, unknown>;
  ZoneDefinitionSchema.parse({ ...current, ...submitted });

  for (const [key, value] of Object.entries(submitted)) {
    doc.set(key, doc.createNode(value));
  }

  writeFileSync(file, doc.toString({ lineWidth: 120 }), 'utf-8');
}

/** Rewrite one zone's metadata, then drop the resource cache. */
export function saveZoneMeta(zoneId: string, meta: Record<string, unknown>): void {
  const file = zoneFileFor(zoneId);
  if (!file) throw new Error(`Unknown zone: ${zoneId}`);
  writeZoneMetaToFile(file, meta);
  invalidateResourceCache();
}

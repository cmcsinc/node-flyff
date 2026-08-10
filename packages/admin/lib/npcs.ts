/**
 * Zone NPC placement browse/edit.
 *
 * NPCs are not their own resource type on disk — each one is an entry in a zone
 * file's `npcs:` sequence (`packages/resources/data/worlds/zones/*.yml`), so an
 * NPC is addressed by the composite ref `<zoneId>:<npcId>` ("flaris:12"), or
 * `<zoneId>:new` to append one.
 *
 * The read/write mechanics are shared with the other zone collections — see
 * `lib/zone-seq.ts`, which owns the `Document`-API writes and the composite-ref
 * parsing. This module is the `npcs:`-specific surface on top of it.
 *
 * @module lib/npcs
 */

import { NpcSchema } from '@flyff/resources';
import {
  deleteZoneEntry,
  deleteZoneEntryFromFile,
  loadZoneRefs,
  nextEntryId,
  parseZoneRef,
  saveZoneEntry,
  writeZoneEntryToFile,
  zoneDocs,
  zoneSeq,
  type ZoneRef,
} from './zone-seq';

const KEY = 'npcs';

export { loadZoneRefs, type ZoneRef };

/** One NPC placement, flattened for the list page. */
export interface NpcRow {
  ref: string;
  zoneId: string;
  zoneName: string;
  id: number;
  moverId: number;
  characterKey: string;
  x: number;
  y: number;
  z: number;
  angle: number;
  functions: number;
}

/** Every NPC placement across every zone file. */ export function loadNpcs(): NpcRow[] {
  const rows: NpcRow[] = [];
  for (const { zoneId, zoneName, doc } of zoneDocs()) {
    for (const npc of zoneSeq(doc, KEY)) {
      const pos = (npc.position ?? {}) as Record<string, unknown>;
      const id = Number(npc.id ?? 0);
      rows.push({
        ref: `${zoneId}:${String(id)}`,
        zoneId,
        zoneName,
        id,
        moverId: Number(npc.mover_id ?? 0),
        characterKey: String(npc.character_key()),
        x: Number(pos.x ?? 0),
        y: Number(pos.y ?? 0),
        z: Number(pos.z ?? 0),
        angle: Number(npc.angle ?? 0),
        functions: Array.isArray(npc.functions) ? npc.functions.length : 0,
      });
    }
  }
  return rows;
}

/** `"flaris:12"` → `{ zoneId: "flaris", npcId: 12 }`; `"flaris:new"` → `npcId: null`. */
export function parseNpcRef(ref: string): { zoneId: string; npcId: number | null } | null {
  const parsed = parseZoneRef(ref);
  return parsed && { zoneId: parsed.zoneId, npcId: parsed.entryId };
}

/** Lowest unused positive id in a zone. */
export const nextNpcId = nextEntryId;

/** A blank NPC, shaped so the generic form editor renders every field. */
export function blankNpc(): Record<string, unknown> {
  return {
    id: 0,
    mover_id: 1,
    character_key: '',
    position: { x: 0, y: 0, z: 0 },
    angle: 0,
    functions: [],
  };
}

/** One NPC entry plus the zone file it lives in. */
export function findNpc(
  zoneId: string,
  npcId: number,
): { file: string; zoneName: string; npc: Record<string, unknown> } | null {
  const zone = zoneDocs().find((z) => z.zoneId === zoneId);
  if (!zone) return null;
  const npc = zoneSeq(zone.doc, KEY).find((n) => Number(n.id) === npcId);
  return npc ? { file: zone.file, zoneName: zone.zoneName, npc } : null;
}

/**
 * Create (`npcId === null`) or replace one NPC in a specific zone file.
 * Returns the written id. Exported for tests; callers use `saveNpc`.
 *
 * Validated against the canonical `NpcSchema` — a bad placement crashes the
 * client's `OnAddObj`, so it must never reach disk.
 */
export function writeNpcToFile(
  file: string,
  npcId: number | null,
  npc: Record<string, unknown>,
): number {
  return writeZoneEntryToFile(file, KEY, NpcSchema, npcId, npc);
}

/** Remove one NPC from a specific zone file. Exported for tests. */
export function deleteNpcFromFile(file: string, npcId: number): boolean {
  return deleteZoneEntryFromFile(file, KEY, npcId);
}

/** Create or replace one NPC in a zone, then drop the resource cache. */
export function saveNpc(
  zoneId: string,
  npcId: number | null,
  npc: Record<string, unknown>,
): number {
  return saveZoneEntry(zoneId, KEY, NpcSchema, npcId, npc);
}

/** Remove one NPC. `false` when the zone or id does not exist. */
export function deleteNpc(zoneId: string, npcId: number): boolean {
  return deleteZoneEntry(zoneId, KEY, npcId);
}

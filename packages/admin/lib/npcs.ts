/**
 * Zone NPC placement browse/edit.
 *
 * NPCs are not their own resource type on disk — each one is an entry in a zone
 * file's `npcs:` sequence (`packages/resources/data/worlds/zones/*.yml`), so an
 * NPC is addressed by the composite ref `<zoneId>:<npcId>` ("flaris:12"), or
 * `<zoneId>:new` to append one.
 *
 * Writes go through the yaml `Document` API, not `stringify(parse(file))`: the
 * zone files carry hand-written header/region comments that a whole-doc rewrite
 * would delete.
 *
 * @module lib/npcs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { parseDocument, isSeq, type YAMLSeq } from "yaml";
import { NpcSchema } from "@flyff/resources";
import { getYamlDir, invalidateResourceCache } from "./resource-cache";

const ZONE_DIR = "worlds/zones";

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

/** Zone identity for filter dropdowns. */
export interface ZoneRef {
  id: string;
  name: string;
}

function zoneDocs() {
  return getYamlDir(ZONE_DIR).map(({ file, doc }) => ({
    file,
    zoneId: String(doc._id ?? ""),
    zoneName: String(doc.name ?? doc._id ?? "?"),
    npcs: Array.isArray(doc.npcs) ? (doc.npcs as Record<string, unknown>[]) : [],
  }));
}

/** Every NPC placement across every zone file. */
export function loadNpcs(): NpcRow[] {
  const rows: NpcRow[] = [];
  for (const { zoneId, zoneName, npcs } of zoneDocs()) {
    for (const npc of npcs) {
      if (typeof npc !== "object" || npc === null) continue;
      const pos = (npc.position ?? {}) as Record<string, unknown>;
      const id = Number(npc.id ?? 0);
      rows.push({
        ref: `${zoneId}:${id}`,
        zoneId,
        zoneName,
        id,
        moverId: Number(npc.mover_id ?? 0),
        characterKey: String(npc.character_key ?? ""),
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

/** All zones that can hold NPCs. */
export function loadZoneRefs(): ZoneRef[] {
  return zoneDocs()
    .filter((z) => z.zoneId)
    .map((z) => ({ id: z.zoneId, name: z.zoneName }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** `"flaris:12"` → `{ zoneId: "flaris", npcId: 12 }`; `"flaris:new"` → `npcId: null`. */
export function parseNpcRef(ref: string): { zoneId: string; npcId: number | null } | null {
  const sep = ref.lastIndexOf(":");
  if (sep <= 0 || sep === ref.length - 1) return null;
  const zoneId = ref.slice(0, sep);
  const tail = ref.slice(sep + 1);
  if (tail === "new") return { zoneId, npcId: null };
  const npcId = Number(tail);
  if (!Number.isInteger(npcId) || npcId <= 0) return null;
  return { zoneId, npcId };
}

/** Lowest unused positive id in a zone. */
export function nextNpcId(existing: readonly number[]): number {
  const used = new Set(existing);
  let id = 1;
  while (used.has(id)) id++;
  return id;
}

/** A blank NPC, shaped so the generic form editor renders every field. */
export function blankNpc(): Record<string, unknown> {
  return {
    id: 0,
    mover_id: 1,
    character_key: "",
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
  for (const z of zoneDocs()) {
    if (z.zoneId !== zoneId) continue;
    const npc = z.npcs.find((n) => Number(n?.id) === npcId);
    if (npc) return { file: z.file, zoneName: z.zoneName, npc };
    return null;
  }
  return null;
}

function zoneFile(zoneId: string): string | null {
  return zoneDocs().find((z) => z.zoneId === zoneId)?.file ?? null;
}

/** Open the zone file's `npcs:` sequence, creating it when absent. */
function openNpcSeq(file: string) {
  const doc = parseDocument(readFileSync(file, "utf-8"));
  let seq = doc.get("npcs");
  if (!isSeq(seq)) {
    doc.set("npcs", []);
    seq = doc.get("npcs");
  }
  if (!isSeq(seq)) throw new Error("Zone file has an unusable npcs node");
  return { doc, seq: seq as YAMLSeq };
}

function seqIds(seq: YAMLSeq): number[] {
  return seq.items
    .map((item) => Number((item as { get?: (k: string) => unknown }).get?.("id")))
    .filter((n) => Number.isInteger(n));
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
  const { doc, seq } = openNpcSeq(file);
  const id = npcId ?? nextNpcId(seqIds(seq));
  const parsed = NpcSchema.parse({ ...npc, id });

  const idx = seq.items.findIndex(
    (item) => Number((item as { get?: (k: string) => unknown }).get?.("id")) === id,
  );
  const node = doc.createNode(parsed);
  if (idx >= 0) seq.set(idx, node);
  else seq.add(node);

  writeFileSync(file, doc.toString({ lineWidth: 120 }), "utf-8");
  return id;
}

/** Remove one NPC from a specific zone file. Exported for tests. */
export function deleteNpcFromFile(file: string, npcId: number): boolean {
  const { doc, seq } = openNpcSeq(file);
  const idx = seq.items.findIndex(
    (item) => Number((item as { get?: (k: string) => unknown }).get?.("id")) === npcId,
  );
  if (idx < 0) return false;

  seq.delete(idx);
  writeFileSync(file, doc.toString({ lineWidth: 120 }), "utf-8");
  return true;
}

/** Create or replace one NPC in a zone, then drop the resource cache. */
export function saveNpc(
  zoneId: string,
  npcId: number | null,
  npc: Record<string, unknown>,
): number {
  const file = zoneFile(zoneId);
  if (!file) throw new Error(`Unknown zone: ${zoneId}`);
  const id = writeNpcToFile(file, npcId, npc);
  invalidateResourceCache();
  return id;
}

/** Remove one NPC. `false` when the zone or id does not exist. */
export function deleteNpc(zoneId: string, npcId: number): boolean {
  const file = zoneFile(zoneId);
  if (!file) return false;
  if (!deleteNpcFromFile(file, npcId)) return false;
  invalidateResourceCache();
  return true;
}

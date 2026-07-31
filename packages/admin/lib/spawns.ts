/**
 * Zone monster-spawn browse/edit.
 *
 * A spawn point is an entry in a zone file's `spawns:` sequence, so it is
 * addressed by the composite ref `<zoneId>:<spawnId>` — the same scheme the NPC
 * placements use, with the same `Document`-API writes (see `lib/zone-seq.ts`).
 *
 * A spawn is materialized once at world-server boot by `SpawnManager.bootstrap()`
 * and lives in memory from then on, so an edit here is not live: the world server
 * must restart before it takes effect.
 *
 * @module lib/spawns
 */

import { SpawnSchema } from "@flyff/resources";
import {
  deleteZoneEntry,
  deleteZoneEntryFromFile,
  nextEntryId,
  saveZoneEntry,
  writeZoneEntryToFile,
  zoneDocs,
  zoneSeq,
} from "./zone-seq";

const KEY = "spawns";

/** One spawn point, flattened for the list page. */
export interface SpawnRow {
  ref: string;
  zoneId: string;
  zoneName: string;
  id: number;
  moverId: number;
  /** Resolved monster name, `""` when the mover id is unknown. */
  moverName: string;
  level: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  count: number;
  /** Respawn delay in ms. */
  delay: number;
}

/** Every spawn point across every zone file. `movers` resolves the names. */
export function loadSpawns(movers: ReadonlyMap<number, { name: string; level: number }>): SpawnRow[] {
  const rows: SpawnRow[] = [];
  for (const { zoneId, zoneName, doc } of zoneDocs()) {
    for (const spawn of zoneSeq(doc, KEY)) {
      const pos = (spawn.position ?? {}) as Record<string, unknown>;
      const moverId = Number(spawn.mover_id ?? 0);
      const mover = movers.get(moverId);
      const id = Number(spawn.id ?? 0);
      rows.push({
        ref: `${zoneId}:${id}`,
        zoneId,
        zoneName,
        id,
        moverId,
        moverName: mover?.name ?? "",
        level: mover?.level ?? 0,        x: Number(pos.x ?? 0),
        y: Number(pos.y ?? 0),
        z: Number(pos.z ?? 0),
        radius: Number(spawn.radius ?? 0),
        count: Number(spawn.count ?? 0),
        delay: Number(spawn.delay ?? 0),
      });
    }
  }
  return rows;
}

/** Lowest unused positive spawn id in a zone. */
export const nextSpawnId = nextEntryId;

/** A blank spawn, shaped so the generic form editor renders every field. */
export function blankSpawn(): Record<string, unknown> {
  return {
    id: 0,
    mover_id: 1,
    position: { x: 0, y: 0, z: 0 },
    radius: 0,
    count: 1,
    delay: 55000,
  };
}

/** One spawn entry plus the zone file it lives in. */
export function findSpawn(
  zoneId: string,
  spawnId: number,
): { file: string; zoneName: string; spawn: Record<string, unknown> } | null {
  const zone = zoneDocs().find((z) => z.zoneId === zoneId);
  if (!zone) return null;
  const spawn = zoneSeq(zone.doc, KEY).find((s) => Number(s.id) === spawnId);
  return spawn ? { file: zone.file, zoneName: zone.zoneName, spawn } : null;
}

/**
 * Create (`spawnId === null`) or replace one spawn in a specific zone file.
 * Returns the written id. Exported for tests; callers use `saveSpawn`.
 *
 * Validated against the canonical `SpawnSchema` — a spawn whose `mover_id` has
 * no propMover entry null-derefs the client's `OnAddObj` when it materializes.
 */
export function writeSpawnToFile(
  file: string,
  spawnId: number | null,
  spawn: Record<string, unknown>,
): number {
  return writeZoneEntryToFile(file, KEY, SpawnSchema, spawnId, spawn);
}

/** Remove one spawn from a specific zone file. Exported for tests. */
export function deleteSpawnFromFile(file: string, spawnId: number): boolean {
  return deleteZoneEntryFromFile(file, KEY, spawnId);
}

/** Create or replace one spawn in a zone, then drop the resource cache. */
export function saveSpawn(
  zoneId: string,
  spawnId: number | null,
  spawn: Record<string, unknown>,
): number {
  return saveZoneEntry(zoneId, KEY, SpawnSchema, spawnId, spawn);
}

/** Remove one spawn. `false` when the zone or id does not exist. */
export function deleteSpawn(zoneId: string, spawnId: number): boolean {
  return deleteZoneEntry(zoneId, KEY, spawnId);
}

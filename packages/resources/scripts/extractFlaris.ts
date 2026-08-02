#!/usr/bin/env tsx
/**
 * extractFlaris -- port every Flaris NPC + monster spawn from the canonical
 * binary world files into `data/worlds/zones/flaris.yml`.
 *
 * Sources (no text form of the .dyo exists; .rgn is UTF-16LE text):
 *   game/resource/World/WdMadrigal/WdMadrigal.dyo  -- every placed object
 *   game/resource/World/WdMadrigal/WdMadrigal.rgn  -- monster respawn regions
 *
 * The runtime `CMover::Read` (Mover.cpp:2896) does NOT match the layout the
 * WorldEditor wrote, so the .dyo is parsed empirically. Two invariants hold:
 *   1. Every record is padded to a fixed 200 bytes (one OT_CTRL record is 500;
 *      it does not match the mover invariant and is skipped).
 *   2. CObj sets `m_dwType = dwObjType` in CreateObj (CreateObj.cpp:628), so a
 *      mover record satisfies DWORD(o) == 5 && DWORD(o + 44) == 5 -- this locates
 *      records regardless of where the non-mover padding falls.
 *
 * Per OT_MOVER record (offsets within the 200-byte slot, from CObj::Read in
 * Obj.cpp:471 + the editor's extra fields):
 *     4   float  m_fAngle   (editor stores degrees -> converted to radians)
 *     20  float  m_vPos.x   (world = raw * OLD_MPU; OLD_MPU = 4, Obj.cpp:522)
 *     24  float  m_vPos.y   (vertical, unchanged)
 *     28  float  m_vPos.z   (world = raw * OLD_MPU)
 *     48  DWORD  m_dwIndex  (MI_* from defineObj.h)
 *     160 char[] m_szCharacterKey (C-string; e.g. "MaFl_DrEstern")
 *     192 DWORD  m_dwBelligerence (BELLI_*; Mover.cpp:3092)
 *
 * `m_dwBelligerence` is per-PLACEMENT and OVERRIDES the propMover row:
 * `CMover::Read` calls `InitProp(FALSE)` (Obj.cpp:511) precisely so the prop's
 * AI + belligerence are skipped, then applies the file's values
 * (Obj.cpp:513-517). 329 of the 347 Flaris placements are `BELLI_PEACEFUL` --
 * including event NPCs on monster models (MaFl_Demian_EVENT on MI_DEMIAN1) --
 * and the remaining 18 are editor-placed monsters. Dropping this field is what
 * made SpawnManager discard 19 placements as "monster-type mover".
 *
 * .rgn `respawn7` line (WorldFile.cpp ReadRespawn):
 *     respawn7 <layer> <MI> <x> <y> <z> <count> <delaySec> <flag>
 *              <minX> <minZ> <maxX> <maxZ> ...
 *
 * Zone metadata (bounds, revival, portals, regions, weather) is preserved from
 * the existing flaris.yml; only `npcs:` and `spawns:` are regenerated.
 *
 * Usage: pnpm extract:flaris
 *
 * @module scripts/extractFlaris
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import { ZoneDefinitionSchema } from '../src/schemas/zone.schema.js';
import type { ZoneDefinition } from '../src/schemas/zone.schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const DYO = resolve(PKG_ROOT, '../../game/resource/World/WdMadrigal/WdMadrigal.dyo');
const RGN = resolve(PKG_ROOT, '../../game/resource/World/WdMadrigal/WdMadrigal.rgn');
const WLD = resolve(PKG_ROOT, '../../game/resource/World/WdMadrigal/WdMadrigal.wld');
const FLARIS_YML = resolve(PKG_ROOT, 'data/worlds/zones/flaris.yml');

/** Object types (CreateObj.cpp dispatch order; OT_MOVER empirically confirmed). */
const OT_MOVER = 5;
/** Obj.cpp:522 -- only x and z are scaled by OLD_MPU; y is unchanged. */
const OLD_MPU = 4;
/** Editor record slot size (empirical; every mover sits on a 200-byte grid). */
const RECORD_SIZE = 200;
/** Offset of `m_dwType` within a record (== dwObjType invariant). */
const M_DWTYPE_OFF = 44;
/** Offset of `m_dwIndex` (the MI_* value) within a record. */
const M_DWINDEX_OFF = 48;
/** Offset of the `m_szCharacterKey` C-string (character.inc key). */
const M_CHARKEY_OFF = 160;
/** Offset of `m_dwBelligerence` -- the placement's belligerence (Mover.cpp:3092). */
const M_BELLI_OFF = 192;

/** Player-template MIs (defineObj.h:961-963) -- not placeable town NPCs. */
const SKIP_MI = new Set([10, 11, 12]); // MI_DEFAULT, MI_MALE, MI_FEMALE

interface Vec3 { readonly x: number; readonly y: number; readonly z: number; }
interface NpcEntry {
  readonly id: number;
  readonly mover_id: number;
  readonly position: Vec3;
  readonly angle: number;
  readonly functions: readonly never[];
  readonly character_key?: string | undefined;
  readonly belligerence?: number | undefined;
}
interface SpawnEntry {
  readonly id: number;
  readonly mover_id: number;
  readonly position: Vec3;
  readonly radius: number;
  readonly count: number;
  readonly delay: number;
}

/** Round to 3 decimals so the YAML is stable across runs (deterministic). */
const r3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Read a NUL-terminated ASCII string from `buf` at `off` (max `max` bytes). */
function cstr(buf: Buffer, off: number, max: number): string {
  let s = '';
  for (let i = 0; i < max && off + i < buf.length; i++) {
    const c = buf.readUInt8(off + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

/** Decode every OT_MOVER record in the .dyo into NPC placement entries. */
function decodeMovers(buf: Buffer): NpcEntry[] {
  const out: NpcEntry[] = [];
  let id = 1;
  for (let o = 0; o + RECORD_SIZE <= buf.length; o += 4) {
    if (buf.readUInt32LE(o) !== OT_MOVER) continue;
    if (buf.readUInt32LE(o + M_DWTYPE_OFF) !== OT_MOVER) continue;

    const mi = buf.readUInt32LE(o + M_DWINDEX_OFF);
    if (SKIP_MI.has(mi)) continue;

    const angleDeg = buf.readFloatLE(o + 4);
    const angle = r3((((angleDeg % 360) + 360) % 360) * Math.PI / 180);
    const position: Vec3 = {
      x: r3(buf.readFloatLE(o + 20) * OLD_MPU),
      y: r3(buf.readFloatLE(o + 24)),
      z: r3(buf.readFloatLE(o + 28) * OLD_MPU),
    };
    const characterKey = cstr(buf, o + M_CHARKEY_OFF, 31);
    out.push({
      id: id++,
      mover_id: mi,
      position,
      angle,
      functions: [],
      character_key: characterKey.length > 0 ? characterKey : undefined,
      belligerence: buf.readUInt32LE(o + M_BELLI_OFF),
    });
  }
  return out;
}

/** Decode every `respawn*` line in the .rgn into monster spawn entries. */
function decodeSpawns(content: string): SpawnEntry[] {
  const out: SpawnEntry[] = [];
  let id = 1;
  for (const line of content.split(/\r?\n/)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 13 || !/^respawn\d+$/.test(f[0])) continue;

    const mi = parseInt(f[2], 10);
    if (!Number.isFinite(mi) || mi <= 0) continue;

    const x = parseFloat(f[3]);
    const y = parseFloat(f[4]);
    const z = parseFloat(f[5]);
    if (![x, y, z].every(Number.isFinite)) continue;

    const count = parseInt(f[6], 10);
    const delaySec = parseInt(f[7], 10);
    const minX = parseFloat(f[9]);
    const minZ = parseFloat(f[10]);
    const maxX = parseFloat(f[11]);
    const maxZ = parseFloat(f[12]);
    const radius = [minX, minZ, maxX, maxZ].every(Number.isFinite)
      ? Math.max(maxX - minX, maxZ - minZ) / 2
      : 0;

    // ponytail: field[6]/field[7] read as count/delay-seconds from the observed
    // `respawn7` layout; confirm against WorldFile.cpp ReadRespawn if exact
    // respawn timing matters (until the combat/spawn-tick system lands).
    out.push({
      id: id++,
      mover_id: mi,
      position: { x: r3(x), y: r3(y), z: r3(z) },
      radius: r3(Math.max(0, radius)),
      count: Math.max(1, Number.isFinite(count) ? count : 1),
      delay: Math.max(1, Number.isFinite(delaySec) ? delaySec : 55) * 1000,
    });
  }
  return out;
}

/** Read a UTF-16LE (BOM) or UTF-8 text file. */
async function readText(path: string): Promise<string> {
  const buf = await readFile(path);
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  return buf.toString('utf8');
}

/** Load the set of MI ids the converter emitted (propMover & defineObj). */
async function loadKnownMoverIds(): Promise<Set<number>> {
  const ids = new Set<number>();
  for (const f of ['monsters.yml', 'npcs.yml', 'player.yml']) {
    const doc = parse(await readFile(resolve(PKG_ROOT, 'data/movers', f), 'utf8')) as
      { movers?: Array<{ dwObjIndex?: number; id?: number }> };
    for (const m of doc.movers ?? []) {
      if (typeof m.dwObjIndex === 'number') ids.add(m.dwObjIndex);
      else if (typeof m.id === 'number') ids.add(m.id);
    }
  }
  return ids;
}

/**
 * Read the world's `fly <0|1>` permission token (`WorldFile.cpp:89-91`).
 * Absent token => C++ default `TRUE` (`World.cpp:92`).
 */
function parseFlyToken(wld: string): boolean {
  const m = /(?:^|\s)fly\s+(\d+)/.exec(wld);
  return m ? m[1] !== '0' : true;
}

async function main(): Promise<void> {
  const [dyoBuf, rgnText, wldText, existingYml, knownMIs] = await Promise.all([
    readFile(DYO),
    readText(RGN),
    readText(WLD),
    readFile(FLARIS_YML, 'utf8'),
    loadKnownMoverIds(),
  ]);

  const zone = parse(existingYml) as ZoneDefinition;

  // Drop placements whose MI never made it into propMover.txt -- SpawnManager
  // would skip them at boot anyway; keeping them fails the zone's referential
  // validation (loaders.test "validate cross-references").
  const rawNpcs = decodeMovers(dyoBuf).filter((n) => knownMIs.has(n.mover_id));
  const rawSpawns = decodeSpawns(rgnText).filter((s) => knownMIs.has(s.mover_id));
  // Renumber contiguously after filtering so ids have no gaps. `character_key`
  // is kept -- it is the authoritative link to the character.inc block (shop
  // stock / dialog / outfit) for NPCs that share a mover model.
  const npcs = rawNpcs.map((n, i) => ({ ...n, id: i + 1 }));
  const spawns = rawSpawns.map((s, i) => ({ ...s, id: i + 1 }));

  // ponytail: NPC functions[] is intentionally empty -- the canonical .dyo only
  // carries model + placement + character_key. Per-block shop stock / menus come
  // from character.inc at load, not from this file. Re-linking explicit shop_id /
  // dialogue_id overrides is a follow-up.
  const next: ZoneDefinition = {
    ...zone,
    fly: parseFlyToken(wldText),
    npcs,
    spawns,
  };

  const validated = ZoneDefinitionSchema.parse(next);

  const header =
    '# worlds/zones/flaris.yml\n' +
    '# Flaris (Zone 1) -- GENERATED from WdMadrigal.dyo + .rgn by scripts/extractFlaris.ts.\n' +
    '# Edit placement via the extractor (or raw/ world files), not by hand.\n';
  await writeFile(FLARIS_YML, header + stringify(validated));

  console.log(`  flaris: ${npcs.length} NPCs, ${spawns.length} spawns written`);
}

main().catch((err: unknown) => {
  console.error('extractFlaris failed:', err);
  process.exit(1);
});

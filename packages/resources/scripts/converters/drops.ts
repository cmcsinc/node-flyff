/**
 * propMoverEx.inc -> data/drops.yml converter.
 *
 * Source: one `MI_<name> { ... }` block per mover. Drop-relevant lines:
 *   Maxitem = N;                            // max simultaneous item drops
 *   DropGold(min, max);                     // penya pile
 *   DropItem(II_..., prob, enchant, count); // 1 slot, prob is DWORD out of 3e9
 *   QuestItem(...) / DropKind(...)          // ponytail -- skipped in v1
 *   AI { ... } / SetCallHelper(...)         // ignored (AI is a separate system)
 *
 * `II_*` item symbols resolve to numeric ids via defineItem.h; `MI_*` resolves
 * to the numeric model index (dwObjIndex) via defineObj.h -- the same map the
 * mover converter uses -- so the loader can key drops by `m_dwIndex` for O(1)
 * lookup at death.
 *
 * The raw `prob` DWORD does NOT survive conversion: it is calibrated to the
 * percent the C++ actually fires at (see {@link calibratePct}) so the data is
 * editable and the runtime can roll it with an unbiased RNG. The third arg is
 * emitted as `enchant`, its real meaning.
 *
 * @module scripts/converters/drops
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stringify } from 'yaml';
import { parseDefines, readSource } from './parse.js';

/** The C++ roll denominator -- `xRandom( 3000000000 )` (`Project.cpp:184`). */
export const DROP_TOTAL = 3_000_000_000;

/**
 * 2^32 mod DROP_TOTAL -- the width of the doubled residue band.
 *
 * `xRandom(n)` is `xRand() % n` over a full-period 32-bit LCG
 * (`_Common/xUtil.h:14-28`). With n = 3e9 and 2^32 = 3e9 + 1,294,967,296, the
 * residues `[0, 1294967295]` are produced by two distinct LCG states each while
 * `[1294967296, 2999999999]` are produced by one. Low residues are therefore
 * exactly twice as likely.
 */
const DOUBLED_BAND = 2 ** 32 - DROP_TOTAL; // 1,294,967,296

/**
 * The percent a raw C++ `prob` **actually** fires at, accounting for the modulo
 * bias of `xRandom(3e9)`.
 *
 * `P(xRand() % 3e9 < prob)` = (number of 32-bit states mapping below `prob`) /
 * 2^32. States below the doubled band count twice:
 *
 *   prob <= band:  2 * prob            / 2^32
 *   prob >  band:  (band + prob)       / 2^32
 *
 * Every probability in the shipped file is under the band, so in practice this
 * is a flat 1.3968x uplift -- `300000000` ("10%") is really 13.97%. Clamped to
 * 100 because three slots ship `prob` above 3e9 (`MI_*` with 30000000000, a data
 * typo the C++ silently treats as always-drop).
 *
 * Exported for the migration script and its tests.
 */
export function calibratePct(prob: number): number {
  if (prob <= 0) return 0;
  if (prob >= DROP_TOTAL) return 100;
  const states = prob <= DOUBLED_BAND ? 2 * prob : DOUBLED_BAND + prob;
  return Math.min(100, (states / 2 ** 32) * 100);
}

/**
 * Round a calibrated percent for storage.
 *
 * 6 significant figures, not a fixed number of decimals: the range spans
 * 0.0000140% to 100%, so `toFixed(4)` would flatten the whole low tail to zero
 * and `toFixed(10)` would give 100% eight meaningless digits. `Number()` drops
 * the trailing zeros `toPrecision` leaves behind, keeping the YAML clean.
 */
export function roundPct(pct: number): number {
  return Number(pct.toPrecision(6));
}

interface DropItem {
  itemId: number;
  chance: number;
  enchant: number;
  count: number;
}

interface DropTable {
  key: string;
  modelIdx: number;
  maxItem: number;
  gold: { min: number; max: number } | null;
  items: DropItem[];
}

/**
 * Parse propMoverEx.inc into drop tables. Exposed for unit testing.
 */
export function parseDropTables(
  content: string,
  iiIds: Map<string, number>,
  miIds: Map<string, number>,
): { tables: DropTable[]; droppedNoMi: number; droppedNoItem: number } {
  const lines = content.split(/\r?\n/);
  const tables: DropTable[] = [];
  let droppedNoMi = 0;
  let droppedNoItem = 0;

    let i = 0;
  // Skip the C++ `/* */` comment block at the top (propMoverEx.inc starts with
  // ~30 lines of Korean comments) + the `MVI_MONSTER` template block.
  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('MI_') && !t.startsWith('MVI_')) break;
  }

  // Top-level block scan: `MI_NAME` on its own line, then `{` on the next.
  for (; i < lines.length; i++) {
    const m = /^MI_(\w+)/.exec(lines[i].trim());
    if (!m) continue;
    const key = 'MI_' + m[1];
    const modelIdx = miIds.get(key);
    if (modelIdx === undefined) { droppedNoMi++; continue; }

    // Collect block body until the next top-level `MI_` header. DropItem /
    // DropGold / Maxitem are always direct children of the MI block (never
    // inside its `AI {}` sub-block), so the next header is the correct boundary.
    // Do NOT delimit by brace counting -- propMoverEx.inc has at least one block
    // with unbalanced braces (MI_GRRR4: 6 `{` vs 5 `}`), which made the scan
    // overrun and swallow every subsequent table's items. That ballooned
    // drops.yml 604KB->89MB and OOM'd the world server before it could register
    // with the cluster (so the client server-select showed no channels).
    let maxItem = 0;
    let gold: { min: number; max: number } | null = null;
    const items: DropItem[] = [];

    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (/^MI_\w+/.test(t)) break; // next top-level block

      let mm = /^Maxitem\s*=\s*(\d+)/.exec(t);
      if (mm) { maxItem = Number(mm[1]); continue; }

      mm = /^DropGold\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(t);
      if (mm) { gold = { min: Number(mm[1]), max: Number(mm[2]) }; continue; }

      mm = /^DropItem\s*\(\s*(II_\w+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(t);
      if (mm) {
        const itemId = iiIds.get(mm[1]);
        if (itemId === undefined) { droppedNoItem++; continue; }
        // The raw DWORD becomes the percent it really fires at. A `prob: 0` slot
        // can never drop in the C++ either (`dwRand < 0` is never true), so it is
        // dead data -- skipped rather than emitted as an unrepresentable 0%.
        const chance = roundPct(calibratePct(Number(mm[2])));
        if (chance <= 0) continue;
        items.push({
          itemId,
          chance,
          enchant: Number(mm[3]),
          count: Number(mm[4]),
        });
        continue;
      }
      // QuestItem / DropKind / AI / SetCallHelper -- intentionally ignored (v1).
    }

    if (maxItem === 0 && !gold && items.length === 0) continue; // empty block
    tables.push({ key, modelIdx, maxItem, gold, items });
  }

  return { tables, droppedNoMi, droppedNoItem };
}

export async function convertDrops(rawDir: string, dataDir: string): Promise<void> {
  const [propMoverEx, defineItem, defineObj] = await Promise.all([
    readSource(resolve(rawDir, 'propMoverEx.inc')),
    readSource(resolve(rawDir, 'defineItem.h')),
    readSource(resolve(rawDir, 'defineObj.h')),
  ]);

  const iiIds = parseDefines(defineItem, 'II_');
  const miIds = parseDefines(defineObj, 'MI_');

  const { tables, droppedNoMi, droppedNoItem } = parseDropTables(propMoverEx, iiIds, miIds);

  const out = resolve(dataDir, 'drops');
  await mkdir(out, { recursive: true });
  const doc = {
    _version: '1.0',
    drops: tables,
  };
  await writeFile(
    resolve(out, 'drops.yml'),
    '# Drop tables -- generated from propMoverEx.inc\n' +
      '# `chance` is a percent. It is the rate the C++ roll ACTUALLY fires at,\n' +
      '# not the nominal prob/3e9: xRandom(3e9) is modulo-biased and every shipped\n' +
      '# probability lands ~1.3968x high. See src/schemas/drop.schema.ts.\n' +
      stringify(doc),
  );

  console.log(
    `  drops: ${tables.length} tables written, ${droppedNoMi} without MI_ id, ${droppedNoItem} DropItems without II_ id dropped`,
  );
}

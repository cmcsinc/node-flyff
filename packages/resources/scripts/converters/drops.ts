/**
 * propMoverEx.inc → data/drops.yml converter.
 *
 * Source: one `MI_<name> { ... }` block per mover. Drop-relevant lines:
 *   Maxitem = N;                         // max simultaneous drops
 *   DropGold(min, max);                  // penya pile
 *   DropItem(II_..., prob, level, count); // 1 slot, prob is DWORD / 3,000,000,000
 *   QuestItem(...) / DropKind(...)       // ponytail — skipped in v1
 *   AI { ... } / SetCallHelper(...)      // ignored (AI is a separate system)
 *
 * `II_*` item symbols resolve to numeric ids via defineItem.h; `MI_*` resolves
 * to the numeric model index (dwObjIndex) via defineObj.h — the same map the
 * mover converter uses — so the loader can key drops by `m_dwIndex` for O(1)
 * lookup at death.
 *
 * @module scripts/converters/drops
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stringify } from 'yaml';
import { parseDefines, readSource } from './parse.js';

/** Per-slot roll denominator — `DropItem` probability is DWORD out of this. */
export const DROP_TOTAL = 3_000_000_000;

/** Probability scalar (researcher: propMoverEx probabilities are /3,000,000,000). */
const DROP_PROB_SCALE = DROP_TOTAL;

interface DropItem {
  itemId: number;
  prob: number;
  level: number;
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
    // Do NOT delimit by brace counting — propMoverEx.inc has at least one block
    // with unbalanced braces (MI_GRRR4: 6 `{` vs 5 `}`), which made the scan
    // overrun and swallow every subsequent table's items. That ballooned
    // drops.yml 604KB→89MB and OOM'd the world server before it could register
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
        items.push({
          itemId,
          prob: Number(mm[2]),
          level: Number(mm[3]),
          count: Number(mm[4]),
        });
        continue;
      }
      // QuestItem / DropKind / AI / SetCallHelper — intentionally ignored (v1).
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
    _prob_scale: DROP_PROB_SCALE,
    drops: tables,
  };
  await writeFile(
    resolve(out, 'drops.yml'),
    '# Drop tables — generated from propMoverEx.inc\n' + stringify(doc),
  );

  console.log(
    `  drops: ${tables.length} tables written, ${droppedNoMi} without MI_ id, ${droppedNoItem} DropItems without II_ id dropped`,
  );
}

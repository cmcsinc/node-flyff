/**
 * One-time migration: `prob` DWORD -> `chance` percent in `data/drops/drops.yml`.
 *
 * The generated file is regenerable from `raw/propMoverEx.inc`, so this exists for
 * two reasons rather than one:
 *
 * 1. `pnpm convert` needs `raw/propMoverEx.inc` present; this needs only the yml.
 * 2. It proves the conversion is arithmetic on existing values, not a re-parse --
 *    a diff of drops.yml before/after shows every slot's chance is exactly
 *    `calibratePct(old prob)`, with nothing else touched.
 *
 * Idempotent: a file already carrying `chance` is left alone.
 *
 * Usage: `pnpm --filter @flyff/resources migrate:drops [--dry]`
 *
 * @module scripts/migrateDropChance
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import { calibratePct, roundPct } from './converters/drops.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(__dirname, '..', 'data', 'drops', 'drops.yml');

const HEADER =
  '# Drop tables -- generated from propMoverEx.inc\n' +
  '# `chance` is a percent. It is the rate the C++ roll ACTUALLY fires at,\n' +
  '# not the nominal prob/3e9: xRandom(3e9) is modulo-biased and every shipped\n' +
  '# probability lands ~1.3968x high. See src/schemas/drop.schema.ts.\n';

interface OldSlot {
  itemId: number;
  prob?: number;
  chance?: number;
  level?: number;
  enchant?: number;
  count: number;
}

interface OldTable {
  key: string;
  modelIdx: number;
  maxItem: number;
  gold: { min: number; max: number } | null;
  items: OldSlot[];
}

interface OldFile {
  _version: string;
  _prob_scale?: number;
  drops: OldTable[];
}

/**
 * Rewrite one file's slots. Returns the new document plus a per-slot tally.
 * Pure -- exported for the test, which asserts the arithmetic without touching
 * the real 604 KB file.
 */
export function migrateDropFile(file: OldFile): {
  doc: { _version: string; drops: OldTable[] };
  converted: number;
  alreadyPercent: number;
  dropped: number;
} {
  let converted = 0;
  let alreadyPercent = 0;
  let dropped = 0;

  const drops = file.drops.map((t) => {
    const items: OldSlot[] = [];
    for (const slot of t.items) {
      if (slot.chance !== undefined) {
        alreadyPercent++;
        items.push(slot);
        continue;
      }
      const chance = roundPct(calibratePct(slot.prob ?? 0));
      // A `prob: 0` slot cannot fire in the C++ either (`dwRand < 0` is never
      // true), so it is dead data and is removed rather than written as a 0%
      // the schema would reject.
      if (chance <= 0) { dropped++; continue; }
      converted++;
      // Key order matters only for the diff's readability: itemId, chance,
      // enchant, count mirrors the converter's emit order.
      items.push({
        itemId: slot.itemId,
        chance,
        enchant: slot.enchant ?? slot.level ?? 0,
        count: slot.count,
      });
    }
    // `_prob_scale` is gone from the file schema; `dropRate` is opt-in and is
    // not invented here.
    return { key: t.key, modelIdx: t.modelIdx, maxItem: t.maxItem, gold: t.gold, items };
  });

  return { doc: { _version: file._version, drops }, converted, alreadyPercent, dropped };
}

async function main(): Promise<void> {
  const dry = process.argv.includes('--dry');
  const parsed = parse(await readFile(FILE, 'utf-8')) as OldFile;

  const { doc, converted, alreadyPercent, dropped } = migrateDropFile(parsed);

  console.log(
    `drops.yml: ${String(doc.drops.length)} tables, ${String(converted)} slots converted, ` +
      `${String(alreadyPercent)} already percent, ${String(dropped)} zero-prob slots removed`,
  );

  if (dry) {
    console.log('--dry: nothing written');
    return;
  }
  await writeFile(FILE, HEADER + stringify(doc), 'utf-8');
  console.log(`wrote ${FILE}`);
}

// Run only when invoked directly, so the test can import the pure part above.
if (process.argv[1]?.endsWith('migrateDropChance.ts')) {
  await main();
}

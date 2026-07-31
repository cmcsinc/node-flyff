/**
 * Drop-chance migration test.
 *
 * The migration is a one-shot, so what matters is that it is *arithmetic on
 * existing values* and not a re-parse: every slot's new `chance` must be exactly
 * `calibratePct(old prob)`, with nothing else in the file touched. It also has to
 * be safe to run twice, since a partially-migrated file is the likely accident.
 *
 * @module test/migrateDropChance.test
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { migrateDropFile } from '../scripts/migrateDropChance';
import { calibratePct, roundPct } from '../scripts/converters/drops';
import { DropFileSchema } from '../src/schemas/drop.schema';

function oldFile() {
  return {
    _version: '1.0',
    _prob_scale: 3_000_000_000,
    drops: [
      {
        key: 'MI_AIBATT1',
        modelIdx: 20,
        maxItem: 2,
        gold: { min: 6, max: 9 },
        items: [
          { itemId: 2950, prob: 300_000_000, level: 0, count: 1 },
          { itemId: 23684, prob: 300, level: 2, count: 10 },
        ],
      },
      { key: 'MI_EMPTY', modelIdx: 21, maxItem: 0, gold: null, items: [] },
    ],
  };
}

describe('migrateDropFile', () => {
  it('converts every prob to its calibrated percent', () => {
    const { doc, converted } = migrateDropFile(oldFile());
    assert.equal(converted, 2);
    const items = doc.drops[0]!.items;
    assert.equal(items[0]!.chance, roundPct(calibratePct(300_000_000)));
    assert.equal(items[0]!.chance, 13.9698);
    assert.equal(items[1]!.chance, roundPct(calibratePct(300)));
    assert.equal(items[1]!.chance, 0.0000139698);
  });

  it('renames level to enchant and keeps count', () => {
    const { doc } = migrateDropFile(oldFile());
    assert.deepEqual(doc.drops[0]!.items[1], {
      itemId: 23684, chance: 0.0000139698, enchant: 2, count: 10,
    });
  });

  it('drops the raw prob and the file-level _prob_scale', () => {
    const { doc } = migrateDropFile(oldFile());
    assert.equal('prob' in doc.drops[0]!.items[0]!, false);
    assert.equal('level' in doc.drops[0]!.items[0]!, false);
    assert.equal('_prob_scale' in doc, false);
  });

  it('leaves everything except the slots untouched', () => {
    const before = oldFile();
    const { doc } = migrateDropFile(before);
    assert.equal(doc._version, '1.0');
    assert.equal(doc.drops.length, 2);
    assert.equal(doc.drops[0]!.key, 'MI_AIBATT1');
    assert.equal(doc.drops[0]!.modelIdx, 20);
    assert.equal(doc.drops[0]!.maxItem, 2);
    assert.deepEqual(doc.drops[0]!.gold, { min: 6, max: 9 });
    // A table with no items survives as an empty one, not as a dropped table.
    assert.deepEqual(doc.drops[1]!.items, []);
  });

  it('does not invent a dropRate', () => {
    // The per-mover multiplier is opt-in; writing 1 everywhere would make every
    // table look deliberately configured.
    const { doc } = migrateDropFile(oldFile());
    assert.equal('dropRate' in doc.drops[0]!, false);
  });

  it('removes a zero-prob slot rather than writing a 0% the schema rejects', () => {
    const file = oldFile();
    file.drops[0]!.items.push({ itemId: 999, prob: 0, level: 0, count: 1 });
    const { doc, dropped } = migrateDropFile(file);
    assert.equal(dropped, 1);
    assert.equal(doc.drops[0]!.items.length, 2);
    assert.equal(doc.drops[0]!.items.some((s) => s.itemId === 999), false);
  });

  it('is idempotent -- a slot already in percent is passed through', () => {
    const once = migrateDropFile(oldFile());
    const twice = migrateDropFile({ _version: '1.0', drops: once.doc.drops } as never);
    assert.equal(twice.converted, 0);
    assert.equal(twice.alreadyPercent, 2);
    assert.deepEqual(twice.doc, once.doc);
  });

  it('produces a document the canonical schema accepts', () => {
    // The real guarantee: the loader must be able to read what this wrote.
    const { doc } = migrateDropFile(oldFile());
    const parsed = DropFileSchema.safeParse(doc);
    assert.ok(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues));
  });
});

/**
 * Drop converter tests -- guards the block-boundary logic in `parseDropTables`
 * and the probability calibration in `calibratePct`.
 *
 * History: the inner scan used to delimit blocks by brace counting starting at
 * depth=1, which double-counted the opener `{` and made every table swallow all
 * subsequent tables' DropItems (604KB source -> 89MB drops.yml -> world OOM).
 * These checks pin the boundary at the next top-level `MI_` header so a
 * malformed block (unbalanced braces) cannot start an overrun again.
 *
 * @module test/converters/drops.test
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseDropTables, calibratePct, roundPct, DROP_TOTAL } from '../../scripts/converters/drops';

function maps(ii: Record<string, number>, mi: Record<string, number>) {
  return {
    iiIds: new Map(Object.entries(ii)),
    miIds: new Map(Object.entries(mi)),
  };
}

/**
 * Independent reference for the true hit rate of `xRand() % 3e9 < prob`.
 *
 * Derived from the state space rather than from `calibratePct`: a 32-bit state
 * `s` passes when `s % 3e9 < prob`, which holds for `s < prob` and again for
 * `s - 3e9 < prob` once `s >= 3e9`. The second window is cut short by 2^32, so
 * it contributes `min(prob, 2^32 - 3e9)`.
 */
function referencePct(prob: number): number {
  const band = 2 ** 32 - DROP_TOTAL;
  const states = Math.min(prob, DROP_TOTAL) + Math.min(prob, band);
  return (states / 2 ** 32) * 100;
}

describe('calibratePct', () => {
  it('maps the shipped probabilities to their real hit rate', () => {
    // Every probability in propMoverEx.inc is inside the doubled residue band,
    // so each is exactly 2x/2^32 -- a flat 1.3968x over the nominal prob/3e9.
    assert.equal(roundPct(calibratePct(300_000_000)), 13.9698); // "10%"
    assert.equal(roundPct(calibratePct(3_000_000)), 0.139698);  // "0.1%"
    assert.equal(roundPct(calibratePct(300)), 0.0000139698);    // the file's floor
  });

  it('is ~1.3968x the nominal rate across the shipped range', () => {
    for (const prob of [300, 1_000, 300_000, 3_000_000, 300_000_000, 1_000_000_000]) {
      const nominal = (prob / DROP_TOTAL) * 100;
      assert.ok(
        Math.abs(calibratePct(prob) / nominal - 1.3968) < 0.001,
        `prob ${String(prob)} uplift should be ~1.3968x`,
      );
    }
  });

  it('agrees with a state-counting reference, including across the band edge', () => {
    const band = 2 ** 32 - DROP_TOTAL;
    for (const prob of [1, 300, 300_000_000, band - 1, band, band + 1, 2_000_000_000, DROP_TOTAL - 1]) {
      assert.ok(
        Math.abs(calibratePct(prob) - referencePct(prob)) < 1e-9,
        `prob ${String(prob)} must match the state count`,
      );
    }
  });

  it('saturates at 100 and floors at 0', () => {
    assert.equal(calibratePct(DROP_TOTAL), 100);
    // Three slots ship prob above 3e9 (a data typo the C++ treats as always-drop).
    assert.equal(calibratePct(30_000_000_000), 100);
    assert.equal(calibratePct(0), 0);
    assert.equal(calibratePct(-5), 0);
  });

  it('never exceeds 100 for any prob under the denominator', () => {
    // The band formula must not overshoot near the top: (band + prob) / 2^32
    // reaches exactly 1 at prob = 3e9 and must not pass it before.
    for (const prob of [DROP_TOTAL - 2, DROP_TOTAL - 1]) {
      assert.ok(calibratePct(prob) < 100, `prob ${String(prob)} should stay under 100`);
      assert.ok(calibratePct(prob) > 99.99);
    }
  });
});

describe('roundPct', () => {
  it('keeps 6 significant figures, not fixed decimals', () => {
    // A fixed 4-decimal round would flatten the whole low tail to 0.
    assert.equal(roundPct(0.0000139698312), 0.0000139698);
    assert.equal(roundPct(13.9698135), 13.9698);
    assert.equal(roundPct(100), 100);
  });

  it('drops trailing zeros so the YAML stays clean', () => {
    // toPrecision(6) alone yields "10.0000"; Number() must strip that.
    assert.equal(roundPct(10), 10);
    assert.equal(String(roundPct(10)), '10');
  });
});

describe('parseDropTables', () => {
  it('collects items only from the matching MI_ block', () => {
    const src = [
      'MI_AIBATT1',
      '{',
      'Maxitem = 2;',
      'DropItem(II_GEN_GEM_GEM_TWINKLESTONE, 300000000, 0, 1);',
      'AI',
      '{',
      '#Scan',
      '{ scan stuff }',
      '}',
      '}',
      'MI_AIBATT2',
      '{',
      'DropItem(II_FOO, 100, 0, 1);',
      '}',
    ].join('\n');
    const { iiIds, miIds } = maps(
      { II_GEN_GEM_GEM_TWINKLESTONE: 2950, II_FOO: 1 },
      { MI_AIBATT1: 20, MI_AIBATT2: 21 },
    );

    const { tables } = parseDropTables(src, iiIds, miIds);

    const a1 = tables.find((t) => t.key === 'MI_AIBATT1');
    const a2 = tables.find((t) => t.key === 'MI_AIBATT2');
    assert.equal(a1?.items.length, 1, 'AIBATT1 must have exactly its own 1 item');
    assert.equal(a2?.items.length, 1, 'AIBATT2 must have exactly its own 1 item');
    assert.equal(a1?.items[0]?.itemId, 2950);
    // The raw DWORD does not survive: 300000000 -> the rate it really fires at.
    assert.equal(a1?.items[0]?.chance, 13.9698);
  });

  it('emits the third arg as `enchant`, not a level requirement', () => {
    // C++ parses it to `dwLevel` whose only live use is SetAbilityOption
    // (Mover.cpp:8005) -- the +N on the dropped instance.
    const src = ['MI_X', '{', 'DropItem(II_A, 300000000, 2, 5);', '}'].join('\n');
    const { iiIds, miIds } = maps({ II_A: 10 }, { MI_X: 1 });
    const { tables } = parseDropTables(src, iiIds, miIds);
    assert.deepEqual(tables[0]?.items[0], { itemId: 10, chance: 13.9698, enchant: 2, count: 5 });
  });

  it('skips a zero-probability slot rather than emitting an unrollable 0%', () => {
    // `dwRand < 0` is never true in the C++ either, so the slot is dead data.
    const src = [
      'MI_X', '{', 'DropItem(II_A, 0, 0, 1);', 'DropItem(II_B, 300000000, 0, 1);', '}',
    ].join('\n');
    const { iiIds, miIds } = maps({ II_A: 10, II_B: 11 }, { MI_X: 1 });
    const { tables } = parseDropTables(src, iiIds, miIds);
    assert.equal(tables[0]?.items.length, 1);
    assert.equal(tables[0]?.items[0]?.itemId, 11);
  });

  it('does not overrun when a block has unbalanced braces', () => {
    // Reproduces MI_GRRR4 from propMoverEx.inc: 6 `{` vs 5 `}`. Brace-count
    // delimited the block end here -> every later table's items were appended
    // to GRRR4. The next `MI_` header must terminate the scan instead.
    const src = [
      'MI_GRRR4',
      '{',
      'Maxitem = 4;',
      'DropItem(II_A, 1, 0, 1);',
      'AI', // opener never closed in this fixture (unbalanced on purpose)
      '{',
      '{',
      'MI_NEXTBLOCK', // next top-level header must bound the scan
      '{',
      'DropItem(II_B, 2, 0, 1);',
      '}',
    ].join('\n');
    const { iiIds, miIds } = maps({ II_A: 10, II_B: 11 }, { MI_GRRR4: 1, MI_NEXTBLOCK: 2 });

    const { tables } = parseDropTables(src, iiIds, miIds);

    const g = tables.find((t) => t.key === 'MI_GRRR4');
    const n = tables.find((t) => t.key === 'MI_NEXTBLOCK');
    assert.equal(g?.items.length, 1, 'GRRR4 must stop at the next MI_ header, not swallow the tail');
    assert.equal(n?.items.length, 1, 'NEXTBLOCK must keep its own item');
    assert.equal(g?.items[0]?.itemId, 10);
    assert.equal(n?.items[0]?.itemId, 11);
  });
});

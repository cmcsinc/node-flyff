/**
 * Drop converter tests -- guards the block-boundary logic in `parseDropTables`.
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
import { parseDropTables } from '../../scripts/converters/drops';

function maps(ii: Record<string, number>, mi: Record<string, number>) {
  return {
    iiIds: new Map(Object.entries(ii)),
    miIds: new Map(Object.entries(mi)),
  };
}

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

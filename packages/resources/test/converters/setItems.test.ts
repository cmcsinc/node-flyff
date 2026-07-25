/**
 * setItem converter tests -- guards the token scanner in `parseSetItems`.
 *
 * Pins the block-boundary + brace-consume logic: a category's inner loop must
 * consume its own closing `}` so the outer loop reaches the next category,
 * and `/* block *\/` comments (the example block above the real defs) must be
 * stripped so the fake `SetItem` inside it is not parsed.
 *
 * @module test/converters/setItems.test
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseSetItems } from '../../scripts/converters/setItems';

function maps(ii: Record<string, number>, parts: Record<string, number>, dst: Record<string, number>) {
  return {
    iiIds: new Map(Object.entries(ii)),
    partsIds: new Map(Object.entries(parts)),
    dstIds: new Map(Object.entries(dst)),
  };
}

describe('parseSetItems', () => {
  it('parses elems + avails and sorts avails ascending by equipped', () => {
    const src = [
      'SetItem\t\t7\tIDS_X',
      '{',
      '\tElem',
      '\t{',
      '\t\tII_HELM\t\tPARTS_CAP',
      '\t\tII_SUIT\t\tPARTS_UPPER_BODY',
      '\t}',
      '\tAvail',
      '\t{',
      '\t\tDST_HP_MAX\t\t150\t4',
      '\t\tDST_STR\t\t3\t2',
      '\t\tDST_HP_MAX\t\t50\t2',
      '\t}',
      '}',
    ].join('\n');
    const { iiIds, partsIds, dstIds } = maps(
      { II_HELM: 526, II_SUIT: 527 },
      { PARTS_CAP: 6, PARTS_UPPER_BODY: 2 },
      { DST_HP_MAX: 35, DST_STR: 1 },
    );
    const { sets, droppedElem, droppedAvail } = parseSetItems(src, iiIds, partsIds, dstIds);
    assert.equal(sets.length, 1);
    assert.equal(droppedElem, 0);
    assert.equal(droppedAvail, 0);
    const s = sets[0]!;
    assert.equal(s.id, 7);
    assert.deepEqual(
      s.elems,
      [{ itemId: 526, parts: 6 }, { itemId: 527, parts: 2 }],
    );
    // File order was 4,2,2 -- output sorted ascending by `equipped` (stable, so
    // the two @2 entries keep input order: STR before HP_MAX).
    assert.deepEqual(
      s.avails.map((a) => [a.dst, a.adj, a.equipped]),
      [[1, 3, 2], [35, 50, 2], [35, 150, 4]],
    );
  });

  it('strips the /* block-comment example so its fake SetItem is not parsed', () => {
    const src = [
      '/* example',
      'SetItem\t\t1\tIDS_FAKE',
      '{',
      '\tElem { II_FAKE PARTS_CAP }',
      '}',
      '*/',
      'SetItem\t\t1\tIDS_REAL',
      '{',
      '\tElem { II_HELM PARTS_CAP }',
      '}',
    ].join('\n');
    const { iiIds, partsIds, dstIds } = maps({ II_HELM: 526 }, { PARTS_CAP: 6 }, {});
    const { sets } = parseSetItems(src, iiIds, partsIds, dstIds);
    assert.equal(sets.length, 1);
    assert.equal(sets[0]!.elems.length, 1);
    assert.equal(sets[0]!.elems[0]!.itemId, 526, 'real block parsed, fake block skipped');
  });

  it('drops an elem whose II_* / PARTS_* symbols are unknown', () => {
    const src = [
      'SetItem\t\t1\tIDS_X',
      '{',
      '\tElem { II_HELM PARTS_CAP II_GHOST PARTS_CAP }',
      '}',
      '}',
    ].join('\n');
    const { iiIds, partsIds, dstIds } = maps({ II_HELM: 526 }, { PARTS_CAP: 6 }, {});
    const { sets, droppedElem } = parseSetItems(src, iiIds, partsIds, dstIds);
    assert.equal(sets[0]!.elems.length, 1, 'unknown symbol elem skipped');
    assert.equal(droppedElem, 1);
  });
});

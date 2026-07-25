/**
 * setItem loader tests.
 *
 * Reads the generated `data/set-items/set-items.yml` (produced by
 * `pnpm convert` from `propItemEtc.inc`) and verifies the index shape: the
 * canonical Vagrant set (id 1) loads with 4 pieces + the documented tiered
 * avails, and every constituent piece maps back to its set. Symbol-resolution
 * coverage lives in the converter test (`test/converters/setItems.test.ts`).
 *
 * @module test/loaders/setItem.loader.test
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSetItems } from '../../src/loaders/setItem.loader';

const DATA_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'data');

// DST ids the assertions reason about (defineAttribute.h).
const DST_HP_MAX = 35;
const DST_SPEED = 11;
const DST_ADJDEF = 26;
const DST_STR = 1;

describe('loadSetItems (real propItemEtc.inc)', () => {
  it('loads 135 sets and resolves every elem itemId + parts', async () => {
    const idx = await loadSetItems(DATA_DIR);
    assert.ok(idx.byId.size > 100, `expected >100 sets, got ${idx.byId.size}`);
    for (const def of idx.byId.values()) {
      for (const e of def.elems) {
        assert.ok(e.itemId > 0, 'elem itemId resolved to a positive id');
        assert.ok(e.parts >= 0, 'elem parts resolved');
      }
    }
  });

  it('Vagrant set (id 1) has 4 pieces + the documented tiered avails', async () => {
    const idx = await loadSetItems(DATA_DIR);
    const vag = idx.byId.get(1);
    assert.ok(vag, 'set id 1 exists');
    assert.equal(vag!.elems.length, 4, 'Vagrant set = helmet+suit+gauntlet+boots');

    // Avails (propItemEtc.inc): DST_HP_MAX 150@4, DST_SPEED 20@3, DST_ADJDEF 23@3,
    // DST_HP_MAX 50@2, DST_STR 3@2. Loader returns them sorted ascending by `equipped`.
    const a = vag!.avails;
    assert.deepEqual(
      a.map((x) => [x.dst, x.adj, x.equipped]),
      [
        [DST_HP_MAX, 50, 2],
        [DST_STR, 3, 2],
        [DST_SPEED, 20, 3],
        [DST_ADJDEF, 23, 3],
        [DST_HP_MAX, 150, 4],
      ],
      'avails sorted ascending by equipped tier',
    );
  });

  it('byItemId maps every constituent piece back to its set', async () => {
    const idx = await loadSetItems(DATA_DIR);
    const vag = idx.byId.get(1)!;
    for (const e of vag.elems) {
      assert.equal(idx.byItemId.get(e.itemId), vag, 'piece maps to its set def');
    }
  });
});

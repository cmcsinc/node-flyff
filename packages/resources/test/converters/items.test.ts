/**
 * Item converter invariant -- fashion vs armor slot separation.
 *
 * propItem `dwParts` for some legacy `_CLO_` fashion rows points at an ARMOR
 * slot (PARTS_CAP=6, PARTS_UPPER_BODY=2, ...). The converter remaps these to
 * the fashion window (PARTS_HAT=26 .. PARTS_BOOTS=29) by IK3 so a costume never
 * collides with real armor. This test pins that invariant on the converted file.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface Item {
  id: number;
  item_kind2?: string;
  item_kind3?: string;
  equip_slot?: number;
}

function loadArmors(): Item[] {
  const doc = parse(readFileSync(resolve(__dirname, '../../data/items/armors.yml'), 'utf8'));
  return (doc.items ?? doc) as Item[];
}

describe('item converter: fashion / armor slot separation', () => {
  it('no IK2_CLOTHETC fashion item lands on an armor slot (2/4/5/6)', () => {
    const bad = loadArmors().filter(
      (it) => (it.item_kind2 === 'IK2_CLOTHETC' || it.item_kind2 === 'IK2_CLOTH') &&
              [2, 4, 5, 6].includes(it.equip_slot ?? -1),
    );
    assert.deepEqual(bad.map((it) => it.id), [], 'fashion items must use PARTS_HAT/CLOTH/GLOVE/BOOTS (26-29)');
  });

  it('armor helmet slot (6) holds only IK3_HELMET, not IK3_HAT', () => {
    const at6 = loadArmors().filter((it) => it.equip_slot === 6);
    assert.ok(at6.length > 0, 'armor helmets exist');
    assert.deepEqual(
      at6.filter((it) => it.item_kind3 !== 'IK3_HELMET').map((it) => it.id),
      [],
      'slot 6 (PARTS_CAP) is armor-only',
    );
  });

  it('fashion hat slot (26) holds IK3_HAT (e.g. Angel Hairband)', () => {
    const at26 = loadArmors().filter((it) => it.equip_slot === 26);
    assert.ok(at26.every((it) => it.item_kind3 === 'IK3_HAT'), 'slot 26 is fashion hats only');
    const angel = loadArmors().find((it) => it.id === 16180);
    assert.equal(angel?.equip_slot, 26, 'Angel Hairband -> PARTS_HAT(26), not PARTS_CAP(6)');
  });
});

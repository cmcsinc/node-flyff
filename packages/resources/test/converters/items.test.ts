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
  name?: string;
  icon?: string;
  item_kind2?: string;
  item_kind3?: string;
  equip_slot?: number;
  stack_size?: number;
  weapon_type?: number;
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

/**
 * The icon texture filename (propItem `szIcon`) is needed so the admin panel can
 * render real item art. It is emitted verbatim minus the triple-quotes, ending in
 * `.dds`. Pinned on a known weapon so a converter regression (e.g. missing the
 * column under an encoding change) fails loudly.
 */
describe('item converter: icon filename populated', () => {
  it('Rodney Axe carries its .dds icon filename', () => {
    const weapons = parse(readFileSync(resolve(__dirname, '../../data/items/weapons.yml'), 'utf8'));
    const items = (weapons.items ?? []) as Item[];
    const rodney = items.find((it) => it.id === 81);
    assert.equal(rodney?.name, 'Rodney Axe');
    assert.equal(rodney?.icon, 'itm_WeaAxeCurin.dds', 'szIcon must be stripped of triple-quotes');
  });

  it('icons end in .dds and carry no stray quotes', () => {
    const weapons = parse(readFileSync(resolve(__dirname, '../../data/items/weapons.yml'), 'utf8'));
    const items = (weapons.items ?? []) as Item[];
    const withIcon = items.filter((it) => it.icon);
    assert.ok(withIcon.length > 50, 'most weapons reference a .dds icon');
    // Extension match is case-insensitive: 229 propItem rows spell it `.DDS`.
    // A case-sensitive check here mirrored the converter bug that dropped every
    // one of those icons, leaving those items with no art in the admin UI.
    assert.ok(
      withIcon.every((it) => /\.dds$/i.test(it.icon!) && !it.icon!.includes('"')),
      'icons are bare .dds filenames',
    );
  });

  it('keeps .DDS-spelled icons (case-insensitive extension)', () => {
    const armors = parse(readFileSync(resolve(__dirname, '../../data/items/armors.yml'), 'utf8'));
    const items = (armors.items ?? []) as Item[];
    const ponycat = items.find((it) => it.id === 4427);
    assert.equal(ponycat?.icon, 'itm_ArmCloMasBall05.DDS');
  });
});

/**
 * propItem `dwWeaponType` is a WT_* SYMBOL (WT_RANGE_BOW, WT_MELEE_YOYO...),
 * not a number. The converter previously read it with `num()`, which returns 0
 * for any symbol, so every weapon lost its type and the combat formula's
 * `getWeaponATK` fell through its `default` sword-STR branch for ALL weapons --
 * bows dealt sword damage, yoyos/knuckles/staves/wands likewise. Pinned on a
 * known bow (Woodness Bow = II_WEA_BOW_WOODNE = 431) so a regression fails
 * loudly. WT_RANGE_BOW=21 per defineAttribute.h.
 */
describe('item converter: weapon_type resolved from WT_* symbol', () => {
  it('Woodness Bow (IK3_BOW) carries weapon_type=21 (WT_RANGE_BOW)', () => {
    const weapons = parse(readFileSync(resolve(__dirname, '../../data/items/weapons.yml'), 'utf8'));
    const items = (weapons.items ?? []) as Item[];
    const bow = items.find((it) => it.id === 431);
    assert.equal(bow?.name, 'Woodness Bow');
    assert.equal(bow?.item_kind3, 'IK3_BOW');
    assert.equal(bow?.weapon_type, 21, 'WT_RANGE_BOW');
  });

  it('every IK3_BOW resolves to WT_RANGE_BOW (21)', () => {
    const weapons = parse(readFileSync(resolve(__dirname, '../../data/items/weapons.yml'), 'utf8'));
    const items = (weapons.items ?? []) as Item[];
    const bows = items.filter((it) => it.item_kind3 === 'IK3_BOW');
    assert.ok(bows.length > 10, 'expected the full bow set');
    assert.deepEqual(
      bows.filter((it) => it.weapon_type !== 21).map((it) => it.id),
      [],
      'all bows must resolve to WT_RANGE_BOW',
    );
  });
});

/**
 * Quest items (IK3_QUEST under IK1_SYSTEM/IK2_SYSTEM) used to be dropped by the
 * converter -- IK1_SYSTEM has no bucket. Without them in the item index,
 * `InventoryService.getStackSize` returned 1 for every quest drop, so each
 * kill created a fresh slot instead of stacking onto the partial pile. This
 * pins the routing fix: quest items land in questitems.yml with dwPackMax
 * preserved as stack_size.
 */
describe('item converter: quest items bucketed with stack_size', () => {
  function loadQuestItems(): { kind: string; items: Item[] } {
    const doc = parse(readFileSync(resolve(__dirname, '../../data/items/questitems.yml'), 'utf8'));
    return { kind: doc._kind, items: (doc.items ?? []) as Item[] };
  }

  it('writes IK3_QUEST items to questitems.yml with _kind=quest', () => {
    const { kind, items } = loadQuestItems();
    assert.equal(kind, 'quest');
    assert.ok(items.length > 100, 'expected the full quest item set (243 in v19)');
    assert.ok(items.every((it) => it.item_kind3 === 'IK3_QUEST'), 'only IK3_QUEST rows');
  });

  it('preserves dwPackMax as stack_size (Vision Stone=20)', () => {
    const { items } = loadQuestItems();
    const vision = items.find((it) => it.id === 6001);
    assert.equal(vision?.name, 'Vision Stone');
    assert.equal(vision?.stack_size, 20, 'Vision Stone must stack to 20');
  });

  it('non-stacking quest items keep stack_size=1 (Boboku Letter)', () => {
    const { items } = loadQuestItems();
    const letter = items.find((it) => it.id === 6002);
    assert.equal(letter?.stack_size, 1, 'Boboku Letter is a unique quest item');
  });
});

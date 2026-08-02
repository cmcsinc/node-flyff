/**
 * EquipService test -- equip/unequip slot moves + validation branches.
 *
 * Equip moves an item from main-bag `invSlot` to `m_Inventory[MAX_INVENTORY+parts]`,
 * swapping any previously-equipped item back into `invSlot`. `parts` must match
 * the item's own `equip_slot` (anti-cheat); RIDE(13) is rejected.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CPlayer, DST } from '@flyff/entities';
import { EquipService } from '../../src/services/equip.service';
import { MAX_INVENTORY } from '@flyff/world-core';
import type { CharacterRow } from '@flyff/database';
import type { ItemDefinition, SetItemDef } from '@flyff/resources';

function makeRow(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 1, account_id: 1, name: 'Tester', slot: 0, class: 0, gender: 0,
    hair_style: 0, hair_color: 0, face_style: 0, skin_color: 0,
    level: 20, exp: 0n, hp: 200, mp: 100, max_hp: 200, max_mp: 100,
    strength: 15, stamina: 15, dexterity: 15, intelligence: 15,
    x: 0, y: 0, z: 0, world_id: 'flaris', zone_id: 1,
    created_at: new Date(), updated_at: new Date(), ...over,
  };
}

function makeSvc(
  getItem: (id: number) => ItemDefinition | undefined,
  opts: { flight?: { canMount(p: CPlayer, prop: ItemDefinition): { ok: true } | { ok: false; tid: number }; mount(p: CPlayer): void; dismount(p: CPlayer): void } } = {},
) {
  const setItemCalls: Array<{ slot: number; itemId: number }> = [];
  const removedSlots: number[] = [];
  const journalCalls: Array<{ type: string }> = [];
  const sent: Buffer[] = [];
  const broadcast: Buffer[] = [];
  const svc = new EquipService({
    inventoryRepo: {
      setItem: async (_c: number, slot: number, itemId: number) => { setItemCalls.push({ slot, itemId }); },
      removeItem: async (_c: number, slot: number) => { removedSlots.push(slot); },
    },
    getItem,
    sendTo: (_p, buf: Buffer) => { sent.push(buf); },
    broadcastAround: (_p, buf: Buffer) => { broadcast.push(buf); },
    flight: opts.flight,
    journal: { append: (e: { type: string }) => { journalCalls.push(e); } } as never,
  });
  return { svc, setItemCalls, removedSlots, journalCalls, sent, broadcast };
}

describe('EquipService.equip', () => {
  it('resolves the equip slot from the item prop when nPart=-1 (client double-click default)', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[0] = { itemId: 5000, count: 1 };
    const table = new Map<number, ItemDefinition>([
      [5000, { id: 5000, name: 'Sword', name_id: 'ITEM_S', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, equip_slot: 9 }],
    ]);
    const { svc } = makeSvc((id) => table.get(id));

    // Client sends nPart = -1 (SendDoEquip default arg) for double-click / drag-drop.
    const r = svc.equip(player, 0, -1);

    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.parts, 9, 'parts resolved from prop.equip_slot');
    assert.equal(player.m_Inventory[MAX_INVENTORY + 9]!.itemId, 5000, 'weapon equipped via auto-resolved slot');
  });

  it('moves the item into the LWEAPON equip slot + journals before persist', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[0] = { itemId: 5000, count: 1 };
    const table = new Map<number, ItemDefinition>([
      [5000, { id: 5000, name: 'Sword', name_id: 'ITEM_S', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, equip_slot: 9 }],
    ]);
    const { svc, journalCalls } = makeSvc((id) => table.get(id));

    const r = svc.equip(player, 0, 9);

    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.parts, 9);
      assert.equal(r.itemId, 5000);
    }
    assert.deepEqual(player.m_Inventory[0], null, 'main-bag slot cleared');
    assert.equal(player.m_Inventory[MAX_INVENTORY + 9]!.itemId, 5000, 'weapon in LWEAPON slot');
    assert.ok(player._dirty.has('m_Inventory'));
    assert.deepEqual(
      journalCalls.map((j) => j.type),
      ['INVENTORY_SLOT', 'INVENTORY_SLOT'],
      'canonical INVENTORY_SLOT journaled for both touched slots',
    );
  });

  it('swaps a previously-equipped item back into the inv slot', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[0] = { itemId: 5001, count: 1 }; // new weapon in bag
    player.m_Inventory[MAX_INVENTORY + 9] = { itemId: 5000, count: 1 }; // equipped old weapon
    const table = new Map<number, ItemDefinition>([
      [5000, { id: 5000, name: 'Old', name_id: 'ITEM_O', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, equip_slot: 9 }],
      [5001, { id: 5001, name: 'New', name_id: 'ITEM_N', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, equip_slot: 9 }],
    ]);
    const { svc } = makeSvc((id) => table.get(id));

    const r = svc.equip(player, 0, 9);

    assert.equal(r.ok, true);
    assert.equal(player.m_Inventory[MAX_INVENTORY + 9]!.itemId, 5001, 'new weapon equipped');
    assert.equal(player.m_Inventory[0]!.itemId, 5000, 'old weapon swapped back to bag');
  });

  it('RIDE(13) under level 20 -> restricted with USEAIRCRAFT(612) tid', () => {
    const player = CPlayer.fromRow(makeRow({ level: 19 }), { write: () => true });
    player.m_Inventory[0] = { itemId: 9000, count: 1 };
    const table = new Map<number, ItemDefinition>([
      [9000, { id: 9000, name: 'Board', name_id: 'ITEM_B', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, equip_slot: 13, flight_limit: 1 }],
    ]);
    const { svc } = makeSvc((id) => table.get(id), {
      flight: {
        canMount: () => ({ ok: false, tid: 612 }),
        mount: () => {},
        dismount: () => {},
      },
    });
    const r = svc.equip(player, 0, 13);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, 'restricted');
      assert.equal(r.tid, 612, 'level-gate refusal carries the USEAIRCRAFT tid');
    }
    assert.equal(player.m_Inventory[0]?.itemId, 9000, 'bag untouched on refusal');
  });

  it('RIDE(13) at level 20 with passing flight dep -> mounts, sets FLY, clears dest', () => {
    const player = CPlayer.fromRow(makeRow({ level: 20 }), { write: () => true });
    player.m_Inventory[0] = { itemId: 9000, count: 1 };
    player.m_idDestObj = 12345;
    let mounted = false;
    const table = new Map<number, ItemDefinition>([
      [9000, { id: 9000, name: 'Board', name_id: 'ITEM_B', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, equip_slot: 13, flight_limit: 1 }],
    ]);
    const { svc } = makeSvc((id) => table.get(id), {
      flight: {
        canMount: () => ({ ok: true }),
        mount: () => { mounted = true; },
        dismount: () => {},
      },
    });
    const r = svc.equip(player, 0, 13);
    assert.equal(r.ok, true);
    assert.equal(mounted, true, 'flight.mount called after slot move');
  });

  it('equips at the prop equip_slot regardless of client nPart (server-authoritative)', () => {
    // Client nPart is advisory -- the server always uses the item's own slot, so
    // a lagging claim (e.g. fashion dwParts remap PARTS_CAP->PARTS_HAT) can't
    // misroute or reject the equip. Client claims UPPER_BODY(2); item is LWEAPON.
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[0] = { itemId: 5000, count: 1 };
    const table = new Map<number, ItemDefinition>([
      [5000, { id: 5000, name: 'Sword', name_id: 'ITEM_S', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, equip_slot: 9 }],
    ]);
    const { svc } = makeSvc((id) => table.get(id));
    const r = svc.equip(player, 0, 2);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.parts, 9, 'equipped at the real slot, not the client claim');
      assert.equal(player.m_Inventory[MAX_INVENTORY + 9]!.itemId, 5000);
    }
  });

  it('rejects out-of-range invSlot and parts', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    const { svc } = makeSvc(() => undefined);
    assert.equal(svc.equip(player, MAX_INVENTORY, 9).ok, false, 'invSlot in equip range');
    assert.equal(svc.equip(player, 0, 0).ok, false, 'parts=0');
    assert.equal(svc.equip(player, 0, 31).ok, false, 'parts>=MAX_HUMAN_PARTS');
  });

  it('rejects when player level below level_req', () => {
    const player = CPlayer.fromRow(makeRow({ level: 5 }), { write: () => true });
    player.m_Inventory[0] = { itemId: 5000, count: 1 };
    const table = new Map<number, ItemDefinition>([
      [5000, { id: 5000, name: 'Sword', name_id: 'ITEM_S', stack_size: 1, weight: 1, level_req: 10, price: 0, sell_price: 0, equip_slot: 9 }],
    ]);
    const { svc } = makeSvc((id) => table.get(id));
    const r = svc.equip(player, 0, 9);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'restricted');
  });

  it('broadcasts one SETDESTPARAM per item effect on equip + RESETDESTPARAM on unequip', () => {
    // v19 Neuz does NOT apply equip DST locally (#ifndef __CLIENT on SetDestParamEquip)
    // so the server must push every effect. Two effects on the ring -> two snapshots.
    const RING = 6100, STR = 1, STA = 2, EQUIP_SLOT = 10;
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[0] = { itemId: RING, count: 1 };
    const table = new Map<number, ItemDefinition>([
      [RING, { id: RING, name: 'Stat Ring', name_id: 'ITEM_R', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, equip_slot: EQUIP_SLOT, effects: [{ dst: STR, adj: 3 }, { dst: STA, adj: 5 }] }],
    ]);
    const { svc, broadcast } = makeSvc((id) => table.get(id));

    const r = svc.equip(player, 0, EQUIP_SLOT);
    assert.equal(r.ok, true);
    assert.equal(broadcast.length, 2, 'one SETDESTPARAM per effect on equip');

    const unequipR = svc.unequip(player, EQUIP_SLOT);
    assert.equal(unequipR.ok, true);
    // 2 from equip + 2 RESETDESTPARAM from unequip = 4 total
    assert.equal(broadcast.length, 4, 'one RESETDESTPARAM per effect on unequip');
  });
});

describe('EquipService.unequip', () => {
  it('moves the equipped item into the first empty main-bag slot', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[MAX_INVENTORY + 9] = { itemId: 5000, count: 1 };
    const { svc, removedSlots } = makeSvc(() => undefined);

    const r = svc.unequip(player, 9);

    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.invSlot, 0, 'first empty main-bag slot');
    assert.equal(player.m_Inventory[MAX_INVENTORY + 9], null, 'equip slot cleared');
    assert.equal(player.m_Inventory[0]!.itemId, 5000, 'item now in bag slot 0');
    assert.ok(removedSlots.includes(MAX_INVENTORY + 9), 'equip slot removed from DB');
  });

  it('rejects unequip of an empty slot with not_equipped', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    const { svc } = makeSvc(() => undefined);
    const r = svc.unequip(player, 9);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'not_equipped');
  });

  it('refreshes cached m_nMaxHp on equip so a later potion heals to the buffed max', () => {
    // A +HP_MAX(35) ring. Cached m_nMaxHp must move up with getMaxHp() -- else a
    // consumable reading the stale cached max caps below the new bar.
    const RING = 6000, HP_MAX = 35, EQUIP_SLOT = 10;
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    const before = player.m_nMaxHp;
    player.m_Inventory[0] = { itemId: RING, count: 1 };
    const table = new Map<number, ItemDefinition>([
      [RING, { id: RING, name: 'HP Ring', name_id: 'ITEM_R', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, equip_slot: EQUIP_SLOT, effects: [{ dst: HP_MAX, adj: 500 }] }],
    ]);
    const { svc } = makeSvc((id) => table.get(id));

    const r = svc.equip(player, 0, EQUIP_SLOT);

    assert.equal(r.ok, true);
    assert.equal(player.m_nMaxHp, player.getMaxHp(), 'cached max tracks derived max');
    assert.equal(player.m_nMaxHp, before + 500, '+HP_MAX flat bonus reflected in cache');
  });

  it('lowers cached m_nMaxHp + clamps current HP down on unequip of +HP gear', () => {
    // Unequip +HP gear: cached max must drop and current HP clamp to it, so a
    // full-heal before the next recovery tick cannot refill over the new max.
    const RING = 6000, HP_MAX = 35, EQUIP_SLOT = 10;
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    const table = new Map<number, ItemDefinition>([
      [RING, { id: RING, name: 'HP Ring', name_id: 'ITEM_R', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, equip_slot: EQUIP_SLOT, effects: [{ dst: HP_MAX, adj: 500 }] }],
    ]);
    const { svc } = makeSvc((id) => table.get(id));
    player.m_Inventory[0] = { itemId: RING, count: 1 };
    svc.equip(player, 0, EQUIP_SLOT);
    player.m_nHp = player.m_nMaxHp; // full on the buffed bar

    const r = svc.unequip(player, EQUIP_SLOT);

    assert.equal(r.ok, true);
    assert.equal(player.m_nMaxHp, player.getMaxHp(), 'cached max tracks derived max after unequip');
    assert.ok(player.m_nHp <= player.m_nMaxHp, 'current HP clamped to the lowered max');
  });
});

describe('EquipService set-item bonuses', () => {
  // A 2-piece armor set (helmet@CAP=6, suit@UPPER_BODY=2) with tiered avails:
  //   2 pieces -> +50 HP_MAX, +3 STR;  ... (higher tiers unlock at more pieces)
  // Mirrors the Vagrant set shape. Item ids 7000/7001 are the pieces.
  const HELM = 7000, SUIT = 7001, CAP = 6, UPPER = 2;
  const SET: SetItemDef = {
    id: 1,
    elems: [{ itemId: HELM, parts: CAP }, { itemId: SUIT, parts: UPPER }],
    avails: [
      { dst: DST.HP_MAX, adj: 50, equipped: 2 },
      { dst: DST.STR, adj: 3, equipped: 2 },
    ],
  };
  const table = new Map<number, ItemDefinition>([
    [HELM, { id: HELM, name: 'Helm', name_id: 'ITEM_H', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, equip_slot: CAP }],
    [SUIT, { id: SUIT, name: 'Suit', name_id: 'ITEM_U', stack_size: 1, weight: 1, level_req: 1, price: 0, sell_price: 0, equip_slot: UPPER }],
  ]);

  function makeSetSvc() {
    return new EquipService({
      inventoryRepo: { setItem: async () => {}, removeItem: async () => {} },
      getItem: (id: number) => table.get(id),
      getSetItem: (id: number) => (id === HELM || id === SUIT ? SET : undefined),
      sendTo: () => {},
    });
  }

  it('grants no set bonus with only one piece equipped', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    const svc = makeSetSvc();
    player.m_Inventory[0] = { itemId: HELM, count: 1 };
    svc.equip(player, 0, CAP);
    assert.equal(player.m_setEffects.length, 0, 'no set effects at 1 piece');
    assert.equal(player.m_params.get(DST.STR, 0), 0, 'no +STR from an incomplete set');
  });

  it('applies the 2-piece tier when the second piece is equipped', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    const svc = makeSetSvc();
    const baseHp = player.getMaxHp();
    player.m_Inventory[0] = { itemId: HELM, count: 1 };
    player.m_Inventory[1] = { itemId: SUIT, count: 1 };
    svc.equip(player, 0, CAP);
    svc.equip(player, 1, UPPER);
    assert.equal(player.m_params.get(DST.STR, 0), 3, '+3 STR from 2-piece set');
    assert.equal(player.getMaxHp(), baseHp + 50, '+50 HP_MAX from 2-piece set');
    assert.equal(player.m_setEffects.length, 2, 'two set effects tracked');
  });

  it('removes the set bonus when a piece is unequipped (recompute drops the tier)', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    const svc = makeSetSvc();
    const baseHp = player.getMaxHp();
    player.m_Inventory[0] = { itemId: HELM, count: 1 };
    player.m_Inventory[1] = { itemId: SUIT, count: 1 };
    svc.equip(player, 0, CAP);
    svc.equip(player, 1, UPPER);
    assert.equal(player.m_setEffects.length, 2, 'set active at 2 pieces');

    svc.unequip(player, UPPER);

    assert.equal(player.m_setEffects.length, 0, 'set bonus gone after dropping below tier');
    assert.equal(player.m_params.get(DST.STR, 0), 0, '+STR removed');
    assert.equal(player.getMaxHp(), baseHp, 'HP_MAX back to base');
  });
});

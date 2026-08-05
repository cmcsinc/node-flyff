/**
 * BlinkwingService test -- the two-pass channel, the gates, and the teleport.
 *
 * The behaviours that matter and would silently regress:
 *  - pass 1 arms a channel and spends NOTHING (a one-pass port would dupe-teleport
 *    for free and let a player chain-blink);
 *  - pass 2 spends the charge and relocates;
 *  - a channel whose item vanished mid-cast refuses with TID_PK_BLINK_LIMIT
 *    instead of teleporting;
 *  - a cross-world destination is refused rather than sent (REPLACE is unported
 *    and nulls the client's `g_pPlayer`);
 *  - TOWNBLINKWING ignores its `=`-inherited prop columns and uses the zone's
 *    revival point.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CPlayer } from '@flyff/entities';
import type { CharacterRow } from '@flyff/database';
import type { ItemDefinition, ZoneDefinition } from '@flyff/resources';
import { STATEMODE } from '@flyff/world-core';
import { BlinkwingService, BLINKWING_TID, II_CHR_SYS_SCR_ESCAPEBLINKWING } from '../../src/services/blinkwing.service';

const REVIVAL = { x: 6978, y: 100, z: 3329 };

function makeRow(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 1, account_id: 1, name: 'Tester', slot: 0, class: 0, gender: 0,
    hair_style: 0, hair_color: 0, face_style: 0, skin_color: 0,
    level: 20, exp: 0n, hp: 200, mp: 100, max_hp: 200, max_mp: 100,
    strength: 15, stamina: 15, dexterity: 15, intelligence: 15,
    x: 100, y: 0, z: 100, world_id: 'flaris', zone_id: 1,
    created_at: new Date(), updated_at: new Date(), ...over,
  };
}

const zones = {
  byNumericId: new Map<number, ZoneDefinition>([
    [1, { world_id: 'madrigal', revival: { position: REVIVAL, radius: 5 } } as never],
  ]),
};

function prop(over: Partial<ItemDefinition> = {}): ItemDefinition {
  return {
    id: 4803, name: 'Blinkwing of Flaris', name_id: 'ITEM_B', stack_size: 999,
    weight: 1, level_req: 1, price: 0, sell_price: 0,
    item_kind2: 'IK2_BLINKWING', item_kind3: 'IK3_BLINKWING',
    ready_ms: 10_000, blink_world: 1, blink_pos: { x: 7161, y: 100, z: 3264 },
    blink_angle: 143,
    ...over,
  } as ItemDefinition;
}

function makeSvc(props: Record<number, ItemDefinition> = {}) {
  const consumes: Array<{ slot: number; count: number }> = [];
  const teleports: Array<{ x: number; y: number; z: number }> = [];
  const stateModes: Array<{ flag: number; itemId?: number }> = [];
  const notices: number[] = [];
  const sent: Buffer[] = [];

  const svc = new BlinkwingService({
    inventoryService: {
      consume: (p: CPlayer, slot: number, count: number) => {
        consumes.push({ slot, count });
        const s = p.m_Inventory[slot];
        if (!s || s.count < count) return null;
        s.count -= count;
        if (s.count <= 0) p.m_Inventory[slot] = null;
        return { ...s, count: s.count };
      },
    } as never,
    playerManager: { sendTo: (_p: CPlayer, buf: Buffer) => { sent.push(buf); } } as never,
    getItem: (id: number) => props[id],
    zones,
    teleport: (p, pos) => { p.m_vPos = { ...pos }; teleports.push(pos); },
    broadcastStateMode: (_p, flag, itemId) => {
      const e: { flag: number; itemId?: number } = { flag };
      if (itemId !== undefined) e.itemId = itemId;
      stateModes.push(e);
    },
    notify: (_p, tid) => { notices.push(tid); },
  });
  return { svc, consumes, teleports, stateModes, notices, sent };
}

function makePlayer(itemId: number, over: Partial<CharacterRow> = {}): CPlayer {
  const p = CPlayer.fromRow(makeRow(over), { write: () => true });
  p.m_Inventory[3] = { itemId, count: 5, objid: 3 };
  return p;
}

describe('BlinkwingService', () => {
  it('pass 1 arms the channel without spending or teleporting', () => {
    const p = prop();
    const { svc, consumes, teleports, stateModes } = makeSvc({ [p.id]: p });
    const player = makePlayer(p.id);

    const r = svc.begin(player, 3, 3, p);

    assert.deepEqual(r, { kind: 'channel', itemId: p.id, readyMs: 10_000 });
    assert.equal(svc.isChanneling(player), true, 'STATE_BASEMOTION_MODE set');
    assert.ok(player.m_nReadyTime > Date.now(), 'ready time in the future');
    assert.equal(player.m_dwUseItemObjId, 3);
    assert.deepEqual(consumes, [], 'no charge spent on the arming pass');
    assert.deepEqual(teleports, [], 'no teleport on the arming pass');
    // ON must carry the item id -- the client reads it for the sfx + bar scale.
    assert.deepEqual(stateModes, [{ flag: STATEMODE.BASEMOTION_ON, itemId: p.id }]);
    assert.equal(player.m_Inventory[3]?.count, 5);
  });

  it('pass 2 spends one charge, teleports, and sets the arrival angle', () => {
    const p = prop();
    const { svc, consumes, teleports, stateModes } = makeSvc({ [p.id]: p });
    const player = makePlayer(p.id);
    svc.begin(player, 3, 3, p);

    svc.complete(player);

    assert.deepEqual(consumes, [{ slot: 3, count: 1 }]);
    assert.deepEqual(teleports, [{ x: 7161, y: 100, z: 3264 }]);
    assert.equal(player.m_fAngle, 143, 'SetAngle from dwItemAtkOrder4');
    assert.equal(player.m_Inventory[3]?.count, 4);
    assert.equal(svc.isChanneling(player), false, 'channel cleared');
    assert.equal(player.m_nReadyTime, 0);
    assert.equal(stateModes.at(-1)?.flag, STATEMODE.BASEMOTION_OFF);
  });

  it('refuses a second channel while one is running', () => {
    const p = prop();
    const { svc } = makeSvc({ [p.id]: p });
    const player = makePlayer(p.id);
    svc.begin(player, 3, 3, p);

    assert.deepEqual(svc.begin(player, 3, 3, p), { kind: 'refuse' });
  });

  it('refuses below the use-level gate with TID_GAME_USINGNOTLEVEL', () => {
    const p = prop({ use_level: 15 });
    const { svc } = makeSvc({ [p.id]: p });
    const player = makePlayer(p.id, { level: 14 });

    assert.deepEqual(svc.begin(player, 3, 3, p), { kind: 'refuse', tid: BLINKWING_TID.USINGNOTLEVEL });
    assert.equal(svc.isChanneling(player), false);
  });

  it('refuses a cross-world destination (REPLACE unported)', () => {
    // WI_DUNGEON_VOLCANE (203) from Madrigal (1).
    const p = prop({ id: 4811, blink_world: 203, blink_pos: { x: 1394, y: 150, z: 544 } });
    const { svc, teleports } = makeSvc({ [p.id]: p });
    const player = makePlayer(p.id);

    assert.deepEqual(svc.begin(player, 3, 3, p), { kind: 'refuse' });
    assert.deepEqual(teleports, []);
  });

  it('TOWNBLINKWING goes to the zone revival point, ignoring its prop columns', () => {
    // Its dwItemAtkOrder columns hold `=`-inherited garbage from the row above.
    const p = prop({ id: 4805, item_kind3: 'IK3_TOWNBLINKWING', blink_pos: { x: 8321, y: 100, z: 3720 } });
    const { svc, teleports } = makeSvc({ [p.id]: p });
    const player = makePlayer(p.id);

    svc.begin(player, 3, 3, p);
    svc.complete(player);

    assert.deepEqual(teleports, [REVIVAL]);
  });

  it('cancels with TID_PK_BLINK_LIMIT when the item vanished mid-channel', () => {
    const p = prop();
    const { svc, teleports, notices, stateModes } = makeSvc({ [p.id]: p });
    const player = makePlayer(p.id);
    svc.begin(player, 3, 3, p);

    player.m_Inventory[3] = null;    // dropped / banked / sold while casting
    svc.complete(player);

    assert.deepEqual(teleports, [], 'no free teleport');
    assert.deepEqual(notices, [BLINKWING_TID.BLINK_LIMIT]);
    assert.equal(stateModes.at(-1)?.flag, STATEMODE.BASEMOTION_CANCEL);
    assert.equal(svc.isChanneling(player), false);
  });

  it('cancel() clears the channel and is a no-op when idle', () => {
    const p = prop();
    const { svc, stateModes } = makeSvc({ [p.id]: p });
    const player = makePlayer(p.id);

    svc.cancel(player);
    assert.deepEqual(stateModes, [], 'idle cancel emits nothing');

    svc.begin(player, 3, 3, p);
    svc.cancel(player);
    assert.equal(svc.isChanneling(player), false);
    assert.equal(player.m_dwUseItemObjId, 0);
    assert.equal(stateModes.at(-1)?.flag, STATEMODE.BASEMOTION_CANCEL);
  });

  it('refuses in flight, except for the Return scroll (REPLACE_FORCE)', () => {
    const wing = prop();
    const scroll = prop({ id: II_CHR_SYS_SCR_ESCAPEBLINKWING, item_kind3: 'IK3_TOWNBLINKWING', ready_ms: 300_000 });
    const { svc } = makeSvc({ [wing.id]: wing, [scroll.id]: scroll });
    const player = makePlayer(wing.id);
    player.m_dwStateFlag |= 0x00000008;  // OBJSTAF.FLY

    assert.deepEqual(svc.begin(player, 3, 3, wing), { kind: 'refuse' });

    player.m_Inventory[3] = { itemId: scroll.id, count: 1, objid: 3 };
    assert.equal(svc.begin(player, 3, 3, scroll).kind, 'channel');
  });

  it('a 0 ms item fires immediately with no channel', () => {
    const p = prop({ ready_ms: 0 });
    const { svc, consumes, teleports, stateModes } = makeSvc({ [p.id]: p });
    const player = makePlayer(p.id);

    const r = svc.begin(player, 3, 3, p);

    assert.deepEqual(r, { kind: 'channel', itemId: p.id, readyMs: 0 });
    assert.deepEqual(consumes, [{ slot: 3, count: 1 }]);
    assert.deepEqual(teleports, [{ x: 7161, y: 100, z: 3264 }]);
    assert.equal(svc.isChanneling(player), false);
    assert.deepEqual(stateModes, [], 'no cast bar for an instant item');
  });
});

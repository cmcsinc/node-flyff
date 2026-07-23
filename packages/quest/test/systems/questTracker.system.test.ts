import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { QuestTrackerSystem } from '../../src/systems/questTracker.system';
import { QUEST_FLAG } from '@flyff/core/constants/quest';
import type { CPlayer } from '@flyff/entities';
import type { QuestDef, QuestIndex, QuestDrop } from '@flyff/resources';
import type { AddItemResult, InventoryService } from '@flyff/inventory';
import { CreateItemSnapshotSerializer } from '@flyff/inventory';
import type { PlayerManager } from '@flyff/world-core';

/** Capturing PlayerManager stub -- records every sendTo by charId. */
function fakePm(players: CPlayer[]): { pm: PlayerManager; sent: Map<number, Buffer[]> } {
  const sent = new Map<number, Buffer[]>();
  for (const p of players) sent.set(p.m_idPlayer, []);
  const pm = {
    all: () => players,
    sendTo: (p: CPlayer, buf: Buffer) => {
      const list = sent.get(p.m_idPlayer) ?? [];
      list.push(buf);
      sent.set(p.m_idPlayer, list);
    },
  } as unknown as PlayerManager;
  return { pm, sent };
}

function mkPlayer(overrides: Partial<CPlayer> = {}): CPlayer {
  const base = {
    m_idPlayer: 1,
    m_vPos: { x: 0, y: 0, z: 0 },
    m_aQuest: [] as unknown[],
    m_Inventory: new Array(73).fill(null),
    _dirty: new Set<string>(),
    findQuest(id: number) {
      return (this.m_aQuest as Array<{ id: number }>).find((q) => q.id === id);
    },
  };
  return { ...base, ...overrides } as unknown as CPlayer;
}

function mkQuests(defs: QuestDef[], drops: Map<number, QuestDrop[]> = new Map()): QuestIndex {
  return { byId: new Map(defs.map((d) => [d.id, d])), drops } as unknown as QuestIndex;
}

/** `SetEndCondItem(sex,type,jobOrItem,item,need)` + a `QuestItem` generator on `monster`. */
function itemQuest(
  id: number, monster: number, item: number, need: number, prob: number, num = 1,
): { def: QuestDef; drop: QuestDrop } {
  const def: QuestDef = {
    _version: '1.0', id, symbol: `Q${id}`, states: {}, quest_items: [],
    commands: [{ cmd: 'SetEndCondItem', args: [
      { type: 'num', value: -1 }, { type: 'num', value: 0 }, { type: 'num', value: -1 },
      { type: 'sym', value: item }, { type: 'num', value: need },
    ] }],
  } as unknown as QuestDef;
  return { def, drop: { mover: monster, item, prob, num, questId: id } };
}

/** Capturing InventoryService stub -- records addItem calls, returns a fixed result. */
function fakeInv(result: AddItemResult): {
  inv: Pick<InventoryService, 'addItem'>;
  calls: Array<{ itemId: number; count: number }>;
} {
  const calls: Array<{ itemId: number; count: number }> = [];
  const inv = {
    addItem: (_p: CPlayer, itemId: number, count: number): AddItemResult => {
      calls.push({ itemId, count });
      return result;
    },
  };
  return { inv, calls };
}

const killQuest = (id: number, monster: number, need: number): QuestDef => ({
  _version: '1.0', id, symbol: `Q${id}`, states: {}, quest_items: [],
  commands: [{ cmd: 'SetEndCondKillNPC', args: [
    { type: 'num', value: 0 }, { type: 'sym', value: monster }, { type: 'num', value: need },
  ] }],
} as unknown as QuestDef);

const patrolQuest = (id: number, l: number, t: number, r: number, b: number): QuestDef => ({
  _version: '1.0', id, symbol: `Q${id}`, states: {}, quest_items: [],
  commands: [{ cmd: 'SetEndCondPatrolZone', args: [
    { type: 'num', value: 0 },
    { type: 'num', value: l }, { type: 'num', value: t },
    { type: 'num', value: r }, { type: 'num', value: b },
  ] }],
} as unknown as QuestDef);

const timeQuest = (id: number, secs: number): QuestDef => ({
  _version: '1.0', id, symbol: `Q${id}`, states: {}, quest_items: [],
  commands: [{ cmd: 'SetEndCondLimitTime', args: [{ type: 'num', value: secs }] }],
} as unknown as QuestDef);

describe('QuestTrackerSystem', () => {
  it('onKill increments the matching slot and emits SETQUEST', () => {
    const def = killQuest(7, 38, 5); // MI=38, need 5
    const player = mkPlayer({ m_aQuest: [{ state: 0, time: 0, id: 7, killNpcNum: [0, 0], flags: 0 } as never] });
    const { pm, sent } = fakePm([player]);
    new QuestTrackerSystem({ quests: mkQuests([def]), playerManager: pm }).onKill(player, 38);
    assert.equal(player.m_aQuest[0].killNpcNum[0], 1);
    assert.equal(sent.get(1)!.length, 1);
    assert.ok(player._dirty.has('m_aQuest'));
  });

  it('onKill caps at the target need and stops emitting', () => {
    const def = killQuest(7, 38, 2);
    const player = mkPlayer({ m_aQuest: [{ state: 0, time: 0, id: 7, killNpcNum: [2, 0], flags: 0 } as never] });
    const { pm, sent } = fakePm([player]);
    new QuestTrackerSystem({ quests: mkQuests([def]), playerManager: pm }).onKill(player, 38);
    assert.equal(player.m_aQuest[0].killNpcNum[0], 2); // unchanged
    assert.equal(sent.get(1)!.length, 0); // no frame -- already at cap
  });

  it('onKill ignores a non-matching monster', () => {
    const def = killQuest(7, 38, 5);
    const player = mkPlayer({ m_aQuest: [{ state: 0, time: 0, id: 7, killNpcNum: [0, 0], flags: 0 } as never] });
    const { pm, sent } = fakePm([player]);
    new QuestTrackerSystem({ quests: mkQuests([def]), playerManager: pm }).onKill(player, 99);
    assert.equal(player.m_aQuest[0].killNpcNum[0], 0);
    assert.equal(sent.get(1)!.length, 0);
  });

  it('onPlayerMoved sets PATROL when the player is inside the rect', () => {
    const def = patrolQuest(7, -10, -10, 10, 10);
    const player = mkPlayer({
      m_vPos: { x: 5, y: 0, z: 5 },
      m_aQuest: [{ state: 0, time: 0, id: 7, killNpcNum: [0, 0], flags: 0 } as never],
    });
    const { pm, sent } = fakePm([player]);
    new QuestTrackerSystem({ quests: mkQuests([def]), playerManager: pm }).onPlayerMoved(player);
    assert.equal(player.m_aQuest[0].flags & QUEST_FLAG.PATROL, QUEST_FLAG.PATROL);
    assert.equal(sent.get(1)!.length, 1);
  });

  it('onPlayerMoved is a no-op outside the rect', () => {
    const def = patrolQuest(7, -10, -10, 10, 10);
    const player = mkPlayer({
      m_vPos: { x: 50, y: 0, z: 50 },
      m_aQuest: [{ state: 0, time: 0, id: 7, killNpcNum: [0, 0], flags: 0 } as never],
    });
    const { pm, sent } = fakePm([player]);
    new QuestTrackerSystem({ quests: mkQuests([def]), playerManager: pm }).onPlayerMoved(player);
    assert.equal(player.m_aQuest[0].flags, 0);
    assert.equal(sent.get(1)!.length, 0);
  });

  it('tick decrements m_wTime and sets bit15 at expiry', () => {
    const def = timeQuest(7, 2); // 2-second limit
    const player = mkPlayer({
      m_aQuest: [{ state: 0, time: 2, id: 7, killNpcNum: [0, 0], flags: 0 } as never],
    });
    const { pm, sent } = fakePm([player]);
    const tracker = new QuestTrackerSystem({ quests: mkQuests([def]), playerManager: pm });

    tracker.tick(1000); // 2 -> 1
    assert.equal(player.m_aQuest[0].time, 1);
    let frames = sent.get(1)!;
    assert.equal(frames.length, 1); // QUEST_TEXT_TIME only (not expired -> no SETQUEST)

    tracker.tick(1000); // 1 -> 0 -> bit15
    assert.equal(player.m_aQuest[0].time, 0x8000);
    frames = sent.get(1)!;
    // accumulated: QUEST_TEXT_TIME (tick1) + QUEST_TEXT_TIME + SETQUEST (tick2 expiry)
    assert.equal(frames.length, 3);
  });

  it('tick ignores quests with no limit-time condition', () => {
    const def = killQuest(7, 38, 5); // no SetEndCondLimitTime
    const player = mkPlayer({
      m_aQuest: [{ state: 0, time: 999, id: 7, killNpcNum: [0, 0], flags: 0 } as never],
    });
    const { pm, sent } = fakePm([player]);
    new QuestTrackerSystem({ quests: mkQuests([def]), playerManager: pm }).tick(1000);
    assert.equal(player.m_aQuest[0].time, 999); // untouched
    assert.equal(sent.get(1)!.length, 0);
  });

  it('persist is fire-and-forget via questRepo.upsertActive', async () => {
    const def = killQuest(7, 38, 5);
    const player = mkPlayer({ m_aQuest: [{ state: 0, time: 0, id: 7, killNpcNum: [0, 0], flags: 0 } as never] });
    const { pm } = fakePm([player]);
    const upserts: unknown[] = [];
    const questRepo = {
      upsertActive: async (charId: number, row: unknown) => { upserts.push({ charId, row }); },
    };
    new QuestTrackerSystem({ quests: mkQuests([def]), playerManager: pm, questRepo })
      .onKill(player, 38);
    // flush fires async; let it drain.
    await new Promise((r) => setImmediate(r));
    assert.equal(upserts.length, 1);
    assert.deepEqual((upserts[0] as { charId: number; row: { kill_npc_num_0: number } }).row.kill_npc_num_0, 1);
  });

  // --- Quest-item drops (onKill -> roll -> addItem -> CREATEITEM/UPDATE_ITEM) ---

  it('onKill drops a quest item on a successful roll and notifies CREATEITEM', () => {
    const { def, drop } = itemQuest(7, 38, 6001, 5, 1_500_000_000); // 50% roll
    const player = mkPlayer({
      m_aQuest: [{ state: 0, time: 0, id: 7, killNpcNum: [0, 0], flags: 0 } as never],
    });
    const { pm, sent } = fakePm([player]);
    const { inv, calls } = fakeInv({ ok: true, slot: 0, itemId: 6001, count: 1, isNew: true });
    const drops = new Map<number, QuestDrop[]>([[38, [drop]]]);
    new QuestTrackerSystem({
      quests: mkQuests([def], drops), playerManager: pm,
      inventoryService: inv, createItemSerializer: new CreateItemSnapshotSerializer(),
      rng: { int: () => 0 }, // 0 < prob -> always succeed
    }).onKill(player, 38);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { itemId: 6001, count: 1 });
    assert.equal(sent.get(1)!.length, 1); // CREATEITEM frame
  });

  it('onKill skips the quest-item drop when the roll fails', () => {
    const { def, drop } = itemQuest(7, 38, 6001, 5, 1_500_000_000);
    const player = mkPlayer({
      m_aQuest: [{ state: 0, time: 0, id: 7, killNpcNum: [0, 0], flags: 0 } as never],
    });
    const { pm, sent } = fakePm([player]);
    const { inv, calls } = fakeInv({ ok: true, slot: 0, itemId: 6001, count: 1, isNew: true });
    const drops = new Map<number, QuestDrop[]>([[38, [drop]]]);
    new QuestTrackerSystem({
      quests: mkQuests([def], drops), playerManager: pm,
      inventoryService: inv, createItemSerializer: new CreateItemSnapshotSerializer(),
      rng: { int: () => Number.MAX_SAFE_INTEGER }, // >= prob -> always fail
    }).onKill(player, 38);
    assert.equal(calls.length, 0);
    assert.equal(sent.get(1)!.length, 0);
  });

  it('onKill caps the grant at the SetEndCondItem need and stops at objective', () => {
    // need 2, player already holds 1 -> grant min(num=5, 2-1)=1
    const { def, drop } = itemQuest(7, 38, 6001, 2, 3_000_000_000, 5); // 100%, num 5
    const player = mkPlayer({
      m_aQuest: [{ state: 0, time: 0, id: 7, killNpcNum: [0, 0], flags: 0 } as never],
      m_Inventory: Object.assign(new Array(73).fill(null), { 0: { itemId: 6001, count: 1 } }),
    });
    const { pm } = fakePm([player]);
    const { inv, calls } = fakeInv({ ok: true, slot: 1, itemId: 6001, count: 1, isNew: true });
    const drops = new Map<number, QuestDrop[]>([[38, [drop]]]);
    new QuestTrackerSystem({
      quests: mkQuests([def], drops), playerManager: pm,
      inventoryService: inv, createItemSerializer: new CreateItemSnapshotSerializer(),
      rng: { int: () => 0 },
    }).onKill(player, 38);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].count, 1); // granted 1, not 5
  });

  it('onKill drops nothing once the player already meets the item objective', () => {
    const { def, drop } = itemQuest(7, 38, 6001, 2, 3_000_000_000);
    const player = mkPlayer({
      m_aQuest: [{ state: 0, time: 0, id: 7, killNpcNum: [0, 0], flags: 0 } as never],
      m_Inventory: Object.assign(new Array(73).fill(null), { 0: { itemId: 6001, count: 2 } }), // == need
    });
    const { pm, sent } = fakePm([player]);
    const { inv, calls } = fakeInv({ ok: true, slot: 0, itemId: 6001, count: 1, isNew: true });
    const drops = new Map<number, QuestDrop[]>([[38, [drop]]]);
    new QuestTrackerSystem({
      quests: mkQuests([def], drops), playerManager: pm,
      inventoryService: inv, createItemSerializer: new CreateItemSnapshotSerializer(),
      rng: { int: () => 0 },
    }).onKill(player, 38);
    assert.equal(calls.length, 0);
    assert.equal(sent.get(1)!.length, 0);
  });

  it('onKill skips quest-item generators for quests the player does not have', () => {
    const { def, drop } = itemQuest(7, 38, 6001, 5, 3_000_000_000);
    const player = mkPlayer({ m_aQuest: [] }); // no active quest
    const { pm, sent } = fakePm([player]);
    const { inv, calls } = fakeInv({ ok: true, slot: 0, itemId: 6001, count: 1, isNew: true });
    const drops = new Map<number, QuestDrop[]>([[38, [drop]]]);
    new QuestTrackerSystem({
      quests: mkQuests([def], drops), playerManager: pm,
      inventoryService: inv, createItemSerializer: new CreateItemSnapshotSerializer(),
      rng: { int: () => 0 },
    }).onKill(player, 38);
    assert.equal(calls.length, 0);
    assert.equal(sent.get(1)!.length, 0);
  });

  it('onKill notifies UPDATE_ITEM when the drop stacks onto an existing slot', () => {
    const { def, drop } = itemQuest(7, 38, 6001, 5, 3_000_000_000);
    const player = mkPlayer({
      m_aQuest: [{ state: 0, time: 0, id: 7, killNpcNum: [0, 0], flags: 0 } as never],
    });
    const { pm, sent } = fakePm([player]);
    const { inv } = fakeInv({ ok: true, slot: 3, itemId: 6001, count: 2, isNew: false });
    const drops = new Map<number, QuestDrop[]>([[38, [drop]]]);
    new QuestTrackerSystem({
      quests: mkQuests([def], drops), playerManager: pm,
      inventoryService: inv, createItemSerializer: new CreateItemSnapshotSerializer(),
      rng: { int: () => 0 },
    }).onKill(player, 38);
    assert.equal(sent.get(1)!.length, 1); // UPDATE_ITEM frame
  });
});

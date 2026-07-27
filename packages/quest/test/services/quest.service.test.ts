import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { QuestService, type QuestInventory } from '../../src/services/quest.service';
import { CPlayer } from '@flyff/entities';
import { QS_BEGIN, QS_END, QUEST_FLAG } from '@flyff/core/constants/quest';
import type { CharacterRow, JournalEntry } from '@flyff/database';
import type { QuestCommand, QuestDef, QuestIndex } from '@flyff/resources';
import { InventoryService } from '@flyff/inventory';
import { CreateItemSnapshotSerializer } from '@flyff/inventory';
import { SNAPSHOTTYPE_CREATEITEM, SNAPSHOTTYPE_SETQUEST, SNAPSHOTTYPE_QUEST_CHECKED } from '@flyff/world-core';

const baseRow = {
  id: 1, account_id: 1, name: 'Tester', slot: 0, class: 0, gender: 0,
  hair_style: 1, hair_color: 1, face_style: 1, skin_color: 1, level: 1,
  exp: 0n, hp: 100, mp: 50, max_hp: 100, max_mp: 50, strength: 15,
  stamina: 15, dexterity: 15, intelligence: 15, x: 0, y: 0, z: 0,
  world_id: 'world1', zone_id: 1, created_at: new Date(), updated_at: new Date(),
} satisfies CharacterRow;

function makePlayer(): CPlayer {
  return CPlayer.fromRow(baseRow, { write: () => true }, 0);
}

describe('quest.service.ts + CPlayer quest helpers', () => {
  it('loadOnJoin hydrates the three arrays from the repo', async () => {
    const repo = {
      loadState: async () => ({
        active: [{
          id: 1, character_id: 1, quest_id: 7, state: QS_BEGIN, time: 60,
          kill_npc_num_0: 2, kill_npc_num_1: 0, flags: QUEST_FLAG.DIALOG, updated_at: new Date(),
        }],
        completed: [3, 4],
        // 5 is stale (not active -> filtered); 7 matches the active quest.
        checked: [5, 7],
      }),
    } as unknown as Parameters<typeof Object> extends never ? never : any;
    const svc = new QuestService({ questRepo: repo });
    const p = makePlayer();
    await svc.loadOnJoin(p);
    assert.equal(p.m_aQuest.length, 1);
    assert.equal(p.m_aQuest[0].id, 7);
    assert.equal(p.m_aQuest[0].state, QS_BEGIN);
    assert.deepEqual(p.m_aQuest[0].killNpcNum, [2, 0]);
    assert.equal(p.m_aQuest[0].flags, QUEST_FLAG.DIALOG);
    assert.deepEqual(p.m_aCompleteQuest, [3, 4]);
    // Stale id 5 dropped (would null-deref the client quick-info sidebar); 7 kept.
    assert.deepEqual(p.m_aCheckedQuest, [7]);
  });

  it('setQuest upserts, findQuest locates, removeQuest clears all lists', () => {
    const p = makePlayer();
    p.setQuest({ state: QS_BEGIN, time: 0, id: 7, killNpcNum: [0, 0], flags: 0 });
    assert.equal(p.findQuest(7)?.state, QS_BEGIN);
    // update in place
    p.setQuest({ state: 5, time: 30, id: 7, killNpcNum: [1, 0], flags: QUEST_FLAG.PATROL });
    assert.equal(p.findQuest(7)?.state, 5);
    assert.equal(p.findQuest(7)?.flags, QUEST_FLAG.PATROL);
    p.m_aCompleteQuest.push(7);
    p.m_aCheckedQuest.push(7);
    p.removeQuest(7);
    assert.equal(p.findQuest(7), undefined);
    assert.equal(p.m_aCompleteQuest.includes(7), false);
    assert.equal(p.m_aCheckedQuest.includes(7), false);
  });

  it('setQuest at QS_END moves the quest to the completed list and refuses re-add', () => {
    const p = makePlayer();
    p.setQuest({ state: QS_BEGIN, time: 0, id: 9, killNpcNum: [0, 0], flags: 0 });
    p.setQuest({ state: QS_END, time: 0, id: 9, killNpcNum: [3, 0], flags: 0 });
    assert.equal(p.findQuest(9), undefined);
    assert.equal(p.isCompleteQuest(9), true);
    // already complete -> re-add is a no-op
    p.setQuest({ state: QS_BEGIN, time: 0, id: 9, killNpcNum: [0, 0], flags: 0 });
    assert.equal(p.findQuest(9), undefined);
  });
});

// --- Phase 3: begin/end engine + QUEST_1 worked example ---

/** QUEST_1 definition as converted from propQuest.inc (vagrant, lvl5-15, 20 teeth -> 500 gold). */
function quest1Def(): QuestDef {
  const num = (value: number): QuestCommand['args'][number] => ({ type: 'num', value });
  const sym = (value: number): QuestCommand['args'][number] => ({ type: 'sym', value });
  return {
    _version: '1.0', id: 7, symbol: 'QUEST_1', title: 'IDS_PROPQUEST_INC_000065',
    states: { '0': { desc: 'x', cond: 'x', status: 'x' } },
    quest_items: [{ mover: 24, item: 6005, prob: 1500000000, num: 1 }],
    commands: [
      { cmd: 'SetCharacter', args: [num(0)] },
      { cmd: 'SetBeginCondLevel', args: [num(5), num(15)] },
      { cmd: 'SetRepeat', args: [num(1)] },
      { cmd: 'SetBeginCondParty', args: [num(0), num(0), num(0), num(0)] },
      { cmd: 'SetBeginCondJob', args: [sym(5)] },
      { cmd: 'SetEndCondLevel', args: [num(5), num(150)] },
      { cmd: 'SetEndCondItem', args: [num(-1), num(0), num(-1), sym(6005), num(20)] },
      { cmd: 'SetEndRemoveItem', args: [num(0), sym(6005), num(-1)] },
      { cmd: 'SetEndRewardGold', args: [num(500), num(500)] },
      { cmd: 'SetHeadQuest', args: [num(6004)] },
    ],
  };
}

/** Fake inventory backed by an in-memory item store. */
function fakeInv(counts: Record<number, number> = {}): QuestInventory {
  const store = { ...counts };
  return {
    count: (id) => store[id] ?? 0,
    emptySlots: () => 32,
    add: (id, n) => { store[id] = (store[id] ?? 0) + n; },
    remove: (id, n) => { store[id] = Math.max(0, (store[id] ?? 0) - n); },
  };
}

function questIndex(def: QuestDef): QuestIndex {
  return { byId: new Map([[def.id, def]]), drops: new Map() };
}

describe('quest.service -- begin/end engine (QUEST_1 worked example)', () => {
  function makeService(inv: QuestInventory, def: QuestDef) {
    const log: JournalEntry[] = [];
    const repo = {
      loadState: async () => ({ active: [], completed: [], checked: [] }),
      upsertActive: async () => {},
      removeActive: async () => {},
      addCompleted: async () => {},
      removeCompleted: async () => {},
      clearCompleted: async () => {},
      setChecked: async () => {},
      insertLog: async () => {},
    };
    const quests = questIndex(def);
    const svc = new QuestService({
      questRepo: repo as unknown as Parameters<typeof Object> extends never ? never : any,
      quests,
      inventory: inv,
      journal: { append: (e) => { log.push(e); return 1; } },
    });
    return { svc, log };
  }

  it('refuses to begin QUEST_1 below level 5', async () => {
    const def = quest1Def();
    const { svc } = makeService(fakeInv(), def);
    const p = CPlayer.fromRow({ ...baseRow, level: 4, class: 5 }, { write: () => true }, 0);
    const res = await svc.beginQuest(p, 7);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, 'level');
  });

  it('begins QUEST_1 at vagrant lvl5-15, then completes on 20 teeth -> 500 gold', async () => {
    const def = quest1Def();
    const inv = fakeInv({ 6005: 20 });
    const { svc } = makeService(inv, def);
    const p = CPlayer.fromRow({ ...baseRow, level: 10, class: 5 }, { write: () => true }, 0);

    const begin = await svc.beginQuest(p, 7);
    assert.equal(begin.ok, true);
    assert.equal(p.findQuest(7)?.state, QS_BEGIN);

    // Teeth in inventory -> isComplete passes.
    const end = await svc.endQuest(p, 7);
    assert.equal(end.ok, true);
    assert.equal(p.findQuest(7), undefined);        // moved out of active
    assert.equal(p.isCompleteQuest(7), true);        // landed in completed list
    assert.equal(p.m_nGold, 500);                    // reward granted
    assert.equal(inv.count(6005), 0);                // 20 teeth removed (count -1)
  });

  it('refuses to complete QUEST_1 without 20 teeth', async () => {
    const def = quest1Def();
    const inv = fakeInv({ 6005: 19 });
    const { svc } = makeService(inv, def);
    const p = CPlayer.fromRow({ ...baseRow, level: 10, class: 5 }, { write: () => true }, 0);
    await svc.beginQuest(p, 7);
    const res = await svc.endQuest(p, 7);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, 'item');
    // Nothing granted, quest still active.
    assert.equal(p.m_nGold, 0);
    assert.equal(p.findQuest(7)?.state, QS_BEGIN);
  });

  it('cancelQuest drops the active record + emits a QUEST_REMOVE frame', async () => {
    const def = quest1Def();
    const { svc } = makeService(fakeInv(), def);
    const p = CPlayer.fromRow({ ...baseRow, level: 10, class: 5 }, { write: () => true }, 0);
    await svc.beginQuest(p, 7);
    const res = await svc.cancelQuest(p, 7);
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.frames.length, 1);
    assert.equal(p.findQuest(7), undefined);
  });

  it('removeAllQuests clears the active list + emits a REMOVEQUEST ALL frame', async () => {
    const def = quest1Def();
    const { svc } = makeService(fakeInv(), def);
    const p = CPlayer.fromRow({ ...baseRow, level: 10, class: 5 }, { write: () => true }, 0);
    await svc.beginQuest(p, 7);
    assert.equal(p.m_aQuest.length, 1);
    const res = await svc.removeAllQuests(p);
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.frames.length, 1);
    assert.equal(p.m_aQuest.length, 0);
    assert.ok(p._dirty.has('m_aQuest'));
  });

  it('removeCompleteQuests clears the completed ledger + emits a CLEAR_COMPLETE frame', async () => {
    const def = quest1Def();
    const { svc } = makeService(fakeInv(), def);
    const p = CPlayer.fromRow({ ...baseRow, level: 10, class: 5 }, { write: () => true }, 0);
    const res = await svc.removeCompleteQuests(p);
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.frames.length, 1);
  });

  it('journals every gold/exp/item mutation through the reward sink', async () => {
    const def = quest1Def();
    const inv = fakeInv({ 6005: 20 });
    const { svc, log } = makeService(inv, def);
    const p = CPlayer.fromRow({ ...baseRow, level: 10, class: 5 }, { write: () => true }, 0);
    await svc.beginQuest(p, 7);
    await svc.endQuest(p, 7);
    const types = log.map((e) => e.type).sort();
    assert.ok(types.includes('CHAR_GOLD'), 'gold reward journaled as absolute CHAR_GOLD');
    // Item removal is no longer journaled via a quest-private type; it now flows
    // through InventoryService (INVENTORY_SLOT/ITEM_CONSUME) when the real bag is
    // wired. Gold/exp WAL coverage remains the crash-recovery surface here.
    assert.equal(types.includes('ITEM_REMOVE'), false);
  });
});

// --- Real InventoryService adapter (questInventory.adapter) ---

const UPDATE_ITEM_SUBTYPE = 0x0018;
const numArg = (value: number): QuestCommand['args'][number] => ({ type: 'num', value });
const symArg = (value: number): QuestCommand['args'][number] => ({ type: 'sym', value });

/** Read the SNAPSHOT sub-type word (offset 14) to discriminate frame bodies. */
function subtype(buf: Buffer): number {
  return buf.readUInt16LE(14);
}

function countInBag(p: CPlayer, itemId: number): number {
  let n = 0;
  for (const s of p.m_Inventory) if (s && s.itemId === itemId) n += s.count;
  return n;
}

function fakeInventoryRepo() {
  return {
    setItem: async () => {},
    removeItem: async () => {},
    updateQuantity: async () => {},
    moveItem: async () => {},
  };
}

function makeRealService(def: QuestDef) {
  const inventoryService = new InventoryService({
    inventoryRepo: fakeInventoryRepo() as never,
    charRepo: { updateGold: async () => {} } as never,
    getStackSize: () => 999, // merge onto one partial stack
  });
  const log: JournalEntry[] = [];
  const repo = {
    loadState: async () => ({ active: [], completed: [], checked: [] }),
    upsertActive: async () => {},
    removeActive: async () => {},
    addCompleted: async () => {},
    removeCompleted: async () => {},
    clearCompleted: async () => {},
    setChecked: async () => {},
    insertLog: async () => {},
  };
  const svc = new QuestService({
    questRepo: repo as never,
    quests: questIndex(def),
    inventoryService,
    createItemSerializer: new CreateItemSnapshotSerializer(),
    journal: { append: (e) => { log.push(e); return 1; } },
  });
  return { svc, log };
}

describe('quest.service -- real InventoryService adapter', () => {
  it('beginQuest grants SetBeginSetAddItem into the bag + emits CREATEITEM', async () => {
    const def: QuestDef = {
      _version: '1.0', id: 7, symbol: 'Q7', states: {}, quest_items: [],
      commands: [
        { cmd: 'SetBeginCondLevel', args: [numArg(1), numArg(150)] },
        { cmd: 'SetBeginSetAddItem', args: [numArg(0), symArg(7000), numArg(2)] },
      ],
    } as unknown as QuestDef;
    const { svc } = makeRealService(def);
    const p = CPlayer.fromRow({ ...baseRow, level: 10 }, { write: () => true }, 0);

    const res = await svc.beginQuest(p, 7);
    assert.equal(res.ok, true);
    if (res.ok) {
      // SETQUEST + QUEST_CHECKED (auto-tracked) + CREATEITEM reward.
      assert.equal(res.frames.length, 3);
      assert.equal(subtype(res.frames[0]!), SNAPSHOTTYPE_SETQUEST);
      assert.equal(subtype(res.frames[1]!), SNAPSHOTTYPE_QUEST_CHECKED);
      assert.equal(subtype(res.frames[2]!), SNAPSHOTTYPE_CREATEITEM);
    }
    assert.equal(p.m_aCheckedQuest.includes(7), true);
    assert.equal(countInBag(p, 7000), 2);
  });

  it('endQuest grants SetEndRewardItem into the bag + emits CREATEITEM', async () => {
    const def: QuestDef = {
      _version: '1.0', id: 7, symbol: 'Q7', states: {}, quest_items: [],
      commands: [
        { cmd: 'SetBeginCondLevel', args: [numArg(1), numArg(150)] },
        { cmd: 'SetEndCondLevel', args: [numArg(1), numArg(150)] },
        { cmd: 'SetEndRewardItem', args: [numArg(-1), numArg(0), numArg(-1), symArg(7100), numArg(3)] },
      ],
    } as unknown as QuestDef;
    const { svc } = makeRealService(def);
    const p = CPlayer.fromRow({ ...baseRow, level: 10 }, { write: () => true }, 0);
    await svc.beginQuest(p, 7);

    const res = await svc.endQuest(p, 7);
    assert.equal(res.ok, true);
    if (res.ok) {
      const reward = res.frames.find((f) => subtype(f) === SNAPSHOTTYPE_CREATEITEM);
      assert.ok(reward, 'CREATEITEM reward frame emitted');
    }
    assert.equal(countInBag(p, 7100), 3);
  });

  it('endQuest removes SetEndRemoveItem from the bag + emits UPDATE_ITEM', async () => {
    const def: QuestDef = {
      _version: '1.0', id: 7, symbol: 'Q7', states: {}, quest_items: [],
      commands: [
        { cmd: 'SetBeginCondLevel', args: [numArg(1), numArg(150)] },
        { cmd: 'SetEndCondLevel', args: [numArg(1), numArg(150)] },
        { cmd: 'SetEndCondItem', args: [numArg(-1), numArg(0), numArg(-1), symArg(6005), numArg(5)] },
        { cmd: 'SetEndRemoveItem', args: [numArg(0), symArg(6005), numArg(5)] },
      ],
    } as unknown as QuestDef;
    const { svc } = makeRealService(def);
    const p = CPlayer.fromRow({ ...baseRow, level: 10 }, { write: () => true }, 0);
    p.m_Inventory[0] = { itemId: 6005, count: 5 };
    await svc.beginQuest(p, 7);

    const res = await svc.endQuest(p, 7);
    assert.equal(res.ok, true);
    assert.equal(countInBag(p, 6005), 0);
    if (res.ok) {
      const update = res.frames.find((f) => subtype(f) === UPDATE_ITEM_SUBTYPE);
      assert.ok(update, 'UPDATE_ITEM removal frame emitted');
    }
  });
});

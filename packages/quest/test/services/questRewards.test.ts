import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CPlayer } from '@flyff/entities';
import { applyBeginSet, applyEnd, type RewardSink } from '../../src/services/questRewards';
import type { JournalEntry } from '@flyff/database';
import type { QuestCommand, QuestDef } from '@flyff/resources';
import type { CharacterRow } from '@flyff/database';

const baseRow = {
  id: 1, account_id: 1, name: 'Tester', slot: 0, class: 5, gender: 0,
  hair_style: 1, hair_color: 1, face_style: 1, skin_color: 1, level: 1,
  exp: 0n, hp: 100, mp: 50, max_hp: 100, max_mp: 50, strength: 15,
  stamina: 15, dexterity: 15, intelligence: 15, x: 0, y: 0, z: 0,
  world_id: 'world1', zone_id: 1, created_at: new Date(), updated_at: new Date(),
} satisfies CharacterRow;

function player(over: Partial<CharacterRow> = {}): CPlayer {
  return CPlayer.fromRow({ ...baseRow, ...over }, { write: () => true }, 0);
}
function cmd(name: string, ...vals: number[]): QuestCommand {
  return { cmd: name, args: vals.map((value) => ({ type: 'num' as const, value })) };
}
function def(commands: QuestCommand[]): QuestDef {
  return { _version: '1.0', id: 1, symbol: 'Q1', commands, states: {}, quest_items: [] };
}

/** Build a capturing sink backed by an in-memory item store. */
function fakeSink(counts: Record<number, number> = {}) {
  const log: JournalEntry[] = [];
  const store = { ...counts };
  const sink: RewardSink = {
    inventory: {
      count: (id) => store[id] ?? 0,
      emptySlots: () => 32,
      add: (id, n) => { store[id] = (store[id] ?? 0) + n; },
      remove: (id, n) => { store[id] = Math.max(0, (store[id] ?? 0) - n); },
    },
    journal: (e) => { log.push(e); },
  };
  return { sink, log, store };
}

describe('questRewards -- applyEnd', () => {
  it('grants gold (min==max deterministic) and journals CHAR_GOLD (absolute)', () => {
    const { sink, log } = fakeSink();
    const p = player();
    applyEnd(p, def([cmd('SetEndRewardGold', 500, 500)]), sink);
    assert.equal(p.m_nGold, 500);
    const row = log.find((e) => e.type === 'CHAR_GOLD');
    assert.equal(row?.type, 'CHAR_GOLD');
    assert.equal((row!.payload as { gold: number }).gold, 500, 'absolute gold total');
  });

  it('removes all of the turn-in item when count is -1 (QUEST_1 teeth)', () => {
    const { sink, store } = fakeSink({ 6005: 20 });
    applyEnd(player(), def([cmd('SetEndRemoveItem', 0, 6005, -1)]), sink);
    assert.equal(store[6005], 0);
  });

  it('removes exactly count when positive', () => {
    const { sink, store } = fakeSink({ 6005: 20 });
    applyEnd(player(), def([cmd('SetEndRemoveItem', 0, 6005, 5)]), sink);
    assert.equal(store[6005], 15);
  });

  it('grants a reward item only when the sex filter matches', () => {
    // Female-only reward (nSex=1): male player (gender 0) gets nothing.
    const male = fakeSink();
    applyEnd(player({ gender: 0 }), def([cmd('SetEndRewardItem', 1, 0, -1, 7000, 1)]), male.sink);
    assert.equal(male.store[7000], undefined);

    const female = fakeSink();
    applyEnd(player({ gender: 1 }), def([cmd('SetEndRewardItem', 1, 0, -1, 7000, 1)]), female.sink);
    assert.equal(female.store[7000], 1);
  });

  it('grants exp, cascades level-ups with carryover, and journals CHAR_EXP (within-level)', () => {
    const { sink, log } = fakeSink();
    const p = player(); // L1, within-level exp 0
    applyEnd(p, def([cmd('SetEndRewardExp', 1000, 1000)]), sink);
    // Thresholds are the raw nExp1 per level (14,20,36,90,152,250,352,480,...).
    // 1000 from L1 exp 0: 1000-14-20-36-90-152-250-352=86 (L8), 86<480 stop.
    assert.equal(p.m_nLevel, 8);
    assert.equal(p.m_nExp, 86);
    const row = log.find((e) => e.type === 'CHAR_EXP');
    assert.equal(row?.type, 'CHAR_EXP');
    assert.equal((row!.payload as { level: number; exp: string }).level, 8);
    assert.equal((row!.payload as { level: number; exp: string }).exp, '86', 'within-level exp, idempotent on replay');
  });

  it('resets within-level exp to 0 at an exact level boundary (no carryover)', () => {
    const { sink } = fakeSink();
    const p = player(); // L1, exp 0 -- L1 threshold is EXP_TABLE[2].nExp1 = 14
    applyEnd(p, def([cmd('SetEndRewardExp', 14, 14)]), sink);
    assert.equal(p.m_nLevel, 2);
    assert.equal(p.m_nExp, 0);
  });
});

describe('questRewards -- applyBeginSet', () => {
  it('grants SetBeginSetAddGold + SetBeginSetAddItem on accept', () => {
    const { sink, store } = fakeSink();
    const p = player();
    applyBeginSet(p, def([
      cmd('SetBeginSetAddGold', 100),
      cmd('SetBeginSetAddItem', 0, 6005, 3),
    ]), sink);
    assert.equal(p.m_nGold, 100);
    assert.equal(store[6005], 3);
  });
});

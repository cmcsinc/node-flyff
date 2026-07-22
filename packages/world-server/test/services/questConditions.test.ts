import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CPlayer } from '../../src/entities/player.js';
import { canBegin, isComplete, type InventoryOps } from '../../src/services/questConditions.js';
import { QUEST_FLAG } from '@flyff/core/constants/quest.js';
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
function def(id: number, commands: QuestCommand[]): QuestDef {
  return { _version: '1.0', id, symbol: `Q${id}`, commands, states: {}, quest_items: [] };
}
function inv(counts: Record<number, number> = {}, empty = 32): InventoryOps {
  return { count: (id) => counts[id] ?? 0, emptySlots: () => empty };
}

describe('questConditions -- canBegin', () => {
  it('passes when no conditions are set', () => {
    assert.equal(canBegin(player(), def(1, []), inv()).ok, true);
  });

  it('fails on level below min', () => {
    const d = def(1, [cmd('SetBeginCondLevel', 5, 15)]);
    assert.deepEqual(canBegin(player({ level: 4 }), d, inv()), { ok: false, reason: 'level' });
    assert.equal(canBegin(player({ level: 10 }), d, inv()).ok, true);
  });

  it('fails on job mismatch (any-of)', () => {
    const d = def(1, [cmd('SetBeginCondJob', 5, 6)]); // vagrant/mercenary
    assert.equal(canBegin(player({ class: 5 }), d, inv()).ok, true);
    assert.deepEqual(canBegin(player({ class: 7 }), d, inv()), { ok: false, reason: 'job' });
  });

  it('fails on sex mismatch (-1 = any)', () => {
    const d = def(1, [cmd('SetBeginCondSex', 1)]); // female-only
    assert.deepEqual(canBegin(player({ gender: 0 }), d, inv()), { ok: false, reason: 'sex' });
    assert.equal(canBegin(player({ gender: 1 }), d, inv()).ok, true);
  });

  it('fails on missing begin item, passes when held', () => {
    const d = def(1, [cmd('SetBeginCondItem', -1, 0, -1, 6005, 5)]);
    assert.deepEqual(canBegin(player(), d, inv({ 6005: 4 })), { ok: false, reason: 'item' });
    assert.equal(canBegin(player(), d, inv({ 6005: 5 })).ok, true);
  });

  it('refuses if the quest is already active or complete', () => {
    const p = player();
    p.setQuest({ state: 0, time: 0, id: 1, killNpcNum: [0, 0], flags: 0 });
    assert.deepEqual(canBegin(p, def(1, []), inv()), { ok: false, reason: 'already_active' });

    const p2 = player();
    p2.m_aCompleteQuest.push(2);
    assert.deepEqual(canBegin(p2, def(2, []), inv()), { ok: false, reason: 'already_complete' });
  });

  it('honours previous-quest requirements (type 1 = must be completed)', () => {
    const d = def(3, [cmd('SetBeginCondPreviousQuest', 1, 2)]);
    assert.deepEqual(canBegin(player(), d, inv()), { ok: false, reason: 'prev_quest' });
    const p = player();
    p.m_aCompleteQuest.push(2);
    assert.equal(canBegin(p, d, inv()).ok, true);
  });
});

describe('questConditions -- isComplete', () => {
  const rt = (over: Partial<{ state: number; time: number; id: number; k: [number, number]; flags: number }> = {}) => ({
    state: over.state ?? 0, time: over.time ?? 0, id: 1,
    killNpcNum: over.k ?? [0, 0], flags: over.flags ?? 0,
  });

  it('fails on missing end item', () => {
    const d = def(1, [cmd('SetEndCondItem', -1, 0, -1, 6005, 20)]);
    assert.deepEqual(isComplete(player(), rt(), d, inv({ 6005: 19 })), { ok: false, reason: 'item' });
    assert.equal(isComplete(player(), rt(), d, inv({ 6005: 20 })).ok, true);
  });

  it('fails until kill count reached', () => {
    const d = def(1, [cmd('SetEndCondKillNPC', 0, 100, 5)]);
    assert.deepEqual(isComplete(player(), rt({ k: [4, 0] }), d, inv()), { ok: false, reason: 'kill' });
    assert.equal(isComplete(player(), rt({ k: [5, 0] }), d, inv()).ok, true);
  });

  it('fails when limit-time has run out', () => {
    const d = def(1, [cmd('SetEndCondLimitTime', 60)]);
    assert.deepEqual(isComplete(player(), rt({ time: 0 }), d, inv()), { ok: false, reason: 'time' });
    assert.equal(isComplete(player(), rt({ time: 30 }), d, inv()).ok, true);
  });

  it('fails until the patrol flag is set', () => {
    const d = def(1, [cmd('SetEndCondPatrolZone', 1, 0, 0, 100, 100)]);
    assert.deepEqual(isComplete(player(), rt({ flags: 0 }), d, inv()), { ok: false, reason: 'patrol' });
    assert.equal(isComplete(player(), rt({ flags: QUEST_FLAG.PATROL }), d, inv()).ok, true);
  });

  it('fails on insufficient gold', () => {
    const d = def(1, [cmd('SetEndCondGold', 1000)]);
    const poor = player(); poor.m_nGold = 500;
    assert.deepEqual(isComplete(poor, rt(), d, inv()), { ok: false, reason: 'gold' });
    const rich = player(); rich.m_nGold = 1000;
    assert.equal(isComplete(rich, rt(), d, inv()).ok, true);
  });
});

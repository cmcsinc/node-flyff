import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { QuestService } from '../../src/services/quest.service.js';
import { CPlayer } from '../../src/entities/player.js';
import { QS_BEGIN, QS_END, QUEST_FLAG } from '@flyff/core/constants/quest.js';
import type { CharacterRow } from '@flyff/database';

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
        checked: [5],
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
    assert.deepEqual(p.m_aCheckedQuest, [5]);
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
    // already complete → re-add is a no-op
    p.setQuest({ state: QS_BEGIN, time: 0, id: 9, killNpcNum: [0, 0], flags: 0 });
    assert.equal(p.findQuest(9), undefined);
  });
});

import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as knexModule from 'knex';
import type { Knex } from '../../src/types';
import { QuestRepository } from '../../src/repositories/quest.repo';
import { up as upInitial } from '../../src/migrations/001_initial';
import { up as upQuests, down as downQuests } from '../../src/migrations/002_quests';

const knex = (knexModule as any).default || knexModule;

describe('quest.repo.ts', () => {
  let db: Knex;
  let repo: QuestRepository;
  let charId: number;

  before(async () => {
    db = knex({ client: 'better-sqlite3', connection: ':memory:', useNullAsDefault: true });
    await upInitial(db);
    await upQuests(db);
    repo = new QuestRepository(db);

    const [accountRow] = await db('accounts')
      .insert({ username: 'questacct', password_hash: 'h' }).returning('id');
    const [charRow] = await db('characters').insert({
      account_id: accountRow.id, name: 'Quester', slot: 0, class: 0,
    }).returning('id');
    charId = charRow.id;
  });

  after(async () => {
    await downQuests(db);
    await db.destroy();
  });

  it('loadState() returns empty state for a fresh character', async () => {
    const state = await repo.loadState(charId);
    assert.deepEqual(state.active, []);
    assert.deepEqual(state.completed, []);
    assert.deepEqual(state.checked, []);
  });

  it('upsertActive() inserts then updates the same quest row', async () => {
    await repo.upsertActive(charId, { quest_id: 7, state: 0, time: 0, kill_npc_num_0: 0, kill_npc_num_1: 0, flags: 0 });
    await repo.upsertActive(charId, { quest_id: 7, state: 14, time: 120, kill_npc_num_0: 5, kill_npc_num_1: 0, flags: 2 });
    const state = await repo.loadState(charId);
    assert.equal(state.active.length, 1);
    assert.equal(state.active[0].quest_id, 7);
    assert.equal(state.active[0].state, 14);
    assert.equal(state.active[0].kill_npc_num_0, 5);
    assert.equal(state.active[0].flags, 2);
  });

  it('addCompleted() is idempotent and removeCompleted() clears it', async () => {
    await repo.addCompleted(charId, 7);
    await repo.addCompleted(charId, 7);
    await repo.addCompleted(charId, 8);
    let state = await repo.loadState(charId);
    assert.deepEqual(state.completed, [7, 8]);
    await repo.removeCompleted(charId, 7);
    state = await repo.loadState(charId);
    assert.deepEqual(state.completed, [8]);
  });

  it('setChecked() replaces the list in slot order', async () => {
    await repo.setChecked(charId, [7, 8, 9]);
    let state = await repo.loadState(charId);
    assert.deepEqual(state.checked, [7, 8, 9]);
    await repo.setChecked(charId, [42]);
    state = await repo.loadState(charId);
    assert.deepEqual(state.checked, [42]);
  });

  it('removeActive() deletes the row', async () => {
    await repo.removeActive(charId, 7);
    const state = await repo.loadState(charId);
    assert.equal(state.active.find((a) => a.quest_id === 7), undefined);
  });

  it('insertLog() writes audit rows', async () => {
    await repo.insertLog(charId, 7, 10);
    await repo.insertLog(charId, 7, 20);
    const rows = await db('quest_log').where({ character_id: charId }).orderBy('id', 'asc');
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r: any) => r.action), [10, 20]);
  });
});

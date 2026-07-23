/**
 * skill.repo.ts test -- loadByCharacter / saveAll / clear / count.
 *
 * Mirrors the in-memory SQLite + 001_initial + 005_skills_slot migrations used
 * by other repo tests. Verifies slot-keyed storage, NULL_ID filtering,
 * delete+reinsert saveAll semantics.
 */

import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as knexModule from 'knex';
import type { Knex } from '../../src/types';
import { SkillRepository, type LearnedSkill } from '../../src/repositories/skill.repo';
import { CharacterRepository } from '../../src/repositories/character.repo';
import { up as up001 } from '../../src/migrations/001_initial';
import { up as up005 } from '../../src/migrations/005_skills_slot';
import { down as down001 } from '../../src/migrations/001_initial';

const knex = (knexModule as any).default || knexModule;

describe('skill.repo.ts', () => {
  let db: Knex;
  let repo: SkillRepository;
  let charId: number;

  before(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
    });
    await up001(db);
    await up005(db);
    repo = new SkillRepository(db);

    const [accountRow] = await db('accounts').insert({
      username: 'skilltest',
      password_hash: 'hash',
    }).returning('id');
    const [row] = await db('characters').insert({
      account_id: accountRow.id,
      name: 'SkillChar',
      slot: 0,
      class: 0,
      gender: 0,
      hair_style: 1,
      hair_color: 1,
      face_style: 1,
      skin_color: 1,
      level: 1,
      exp: 0,
      hp: 100,
      mp: 50,
      max_hp: 100,
      max_mp: 50,
      strength: 15,
      stamina: 15,
      dexterity: 15,
      intelligence: 15,
      x: 0, y: 0, z: 0,
      world_id: 'world1',
      zone_id: 1,
    }).returning('id');
    charId = row.id;
  });

  after(async () => {
    await down001(db);
    await db.destroy();
  });

  it('loadByCharacter returns empty for a fresh character', async () => {
    const rows = await repo.loadByCharacter(charId);
    assert.deepEqual(rows, []);
  });

  it('saveAll persists learned slots (NULL_ID entries filtered)', async () => {
    const slots: LearnedSkill[] = [
      { slot: 0, skillId: 1, level: 5 },
      { slot: 1, skillId: 2, level: 3 },
      { slot: 2, skillId: 0xffffffff, level: 0 }, // empty -- must be dropped
      { slot: 3, skillId: 0, level: 0 },          // invalid -- must be dropped
      { slot: 22, skillId: 64, level: 1 },
    ];
    await repo.saveAll(charId, slots);
    const loaded = await repo.loadByCharacter(charId);
    assert.equal(loaded.length, 3);
    assert.deepEqual(loaded[0], { slot: 0, skillId: 1, level: 5 });
    assert.deepEqual(loaded[1], { slot: 1, skillId: 2, level: 3 });
    assert.deepEqual(loaded[2], { slot: 22, skillId: 64, level: 1 });
  });

  it('saveAll replaces existing rows (delete + reinsert)', async () => {
    const slots: LearnedSkill[] = [
      { slot: 0, skillId: 1, level: 10 }, // bump L5 -> L10
      { slot: 5, skillId: 100, level: 1 }, // new slot
    ];
    await repo.saveAll(charId, slots);
    const loaded = await repo.loadByCharacter(charId);
    assert.equal(loaded.length, 2);
    assert.equal(loaded[0]!.level, 10, 'slot 0 level updated');
    assert.equal(loaded[1]!.slot, 5, 'slot 5 added');
    // Old slots (1, 22) should be gone
    assert.ok(!loaded.some((s) => s.slot === 22));
  });

  it('saveAll with empty array clears the table', async () => {
    await repo.saveAll(charId, []);
    const loaded = await repo.loadByCharacter(charId);
    assert.deepEqual(loaded, []);
  });

  it('count returns the learned-slot count', async () => {
    await repo.saveAll(charId, [
      { slot: 0, skillId: 1, level: 1 },
      { slot: 3, skillId: 4, level: 2 },
    ]);
    const n = await repo.count(charId);
    assert.equal(n, 2);
  });

  it('clear removes all rows for the character', async () => {
    await repo.clear(charId);
    const n = await repo.count(charId);
    assert.equal(n, 0);
  });

  it('loadByCharacter drops rows outside the 0-44 slot range', async () => {
    await db('skills').insert({
      character_id: charId,
      slot: 99, // invalid
      skill_id: 1,
      level: 1,
    });
    await db('skills').insert({
      character_id: charId,
      slot: 5, // valid
      skill_id: 2,
      level: 1,
    });
    const loaded = await repo.loadByCharacter(charId);
    assert.equal(loaded.length, 1, 'invalid slot dropped');
    assert.equal(loaded[0]!.slot, 5);
    await repo.clear(charId);
  });
});

describe('character.repo -- updateSkillPoints', () => {
  let db: Knex;
  let charId: number;

  before(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: ':memory:',
      useNullAsDefault: true,
    });
    await up001(db);
    await up005(db);

    const [accountRow] = await db('accounts').insert({
      username: 'sp',
      password_hash: 'hash',
    }).returning('id');
    const [row] = await db('characters').insert({
      account_id: accountRow.id,
      name: 'SPChar',
      slot: 0,
      class: 0,
      gender: 0,
      hair_style: 1,
      hair_color: 1,
      face_style: 1,
      skin_color: 1,
      level: 1,
      exp: 0,
      hp: 100,
      mp: 50,
      max_hp: 100,
      max_mp: 50,
      strength: 15,
      stamina: 15,
      dexterity: 15,
      intelligence: 15,
      x: 0, y: 0, z: 0,
      world_id: 'world1',
      zone_id: 1,
    }).returning('id');
    charId = row.id;
  });

  after(async () => {
    await down001(db);
    await db.destroy();
  });

  it('default skill_point=0, skill_level=0 on a fresh character', async () => {
    const repo = new CharacterRepository(db);
    const c = await repo.findById(charId);
    assert.ok(c);
    assert.equal(c!.skill_point, 0);
    assert.equal(c!.skill_level, 0);
  });

  it('updateSkillPoints persists both columns', async () => {
    const repo = new CharacterRepository(db);
    await repo.updateSkillPoints(charId, 15, 27);
    const c = await repo.findById(charId);
    assert.equal(c!.skill_point, 15);
    assert.equal(c!.skill_level, 27);
  });
});

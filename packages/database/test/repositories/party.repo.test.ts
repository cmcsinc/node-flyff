/**
 * party.repo.ts test -- durable roster round-trip, slot order, id counter.
 *
 * The invariant that matters: `slot` is positional and slot 0 is the leader, so
 * `loadAll` must return members in slot order and `replaceMembers` must never
 * leave two members claiming a slot. `maxId` seeds `PartyManager`'s in-memory id
 * counter, so a fresh party after a restart cannot collide with a stored one.
 */

import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as knexModule from 'knex';
import type { Knex } from '../../src/types';
import { PartyRepository, type PartyWithMembers } from '../../src/repositories/party.repo';
import { up as up001 } from '../../src/migrations/001_initial';
import { up as up022 } from '../../src/migrations/022_parties';

const knex = (knexModule as any).default || knexModule;

describe('party.repo.ts', () => {
  let db: Knex;
  let repo: PartyRepository;
  const chars: number[] = [];

  async function makeChar(name: string, slot: number): Promise<number> {
    const [row] = await db('characters').insert({
      account_id: 1, name, slot, class: 0, gender: 0,
      hair_style: 1, hair_color: 1, face_style: 1, skin_color: 1,
      level: 1, exp: 0, hp: 100, mp: 50, max_hp: 100, max_mp: 50,
      strength: 15, stamina: 15, dexterity: 15, intelligence: 15,
      x: 0, y: 0, z: 0, world_id: 'world1', zone_id: 1,
    }).returning('id');
    return row.id;
  }

  function party(id: number, members: number[]): PartyWithMembers {
    return {
      id, kindTroup: 0, name: '', level: 1, exp: 0, point: 0,
      expMode: 0, itemMode: 0, lastItemGetterId: 0, members,
    };
  }

  before(async () => {
    db = knex({ client: 'better-sqlite3', connection: ':memory:', useNullAsDefault: true });
    await up001(db);
    await up022(db);
    await db('accounts').insert({ id: 1, username: 'a', password_hash: 'x' });
    for (let i = 0; i < 4; i++) chars.push(await makeChar(`C${i}`, i));
    repo = new PartyRepository(db);
  });

  after(async () => { await db.destroy(); });

  it('create + loadAll round-trips the roster in slot order', async () => {
    const members = [chars[0]!, chars[1]!, chars[2]!];
    await repo.create({ ...party(1, members), kindTroup: 1, name: 'Troupe', level: 4, point: 60, itemMode: 3 });
    const all = await repo.loadAll();
    assert.equal(all.length, 1);
    assert.deepEqual(all[0]!.members, members, 'leader first');
    assert.equal(all[0]!.kindTroup, 1);
    assert.equal(all[0]!.name, 'Troupe');
    assert.equal(all[0]!.level, 4);
    assert.equal(all[0]!.point, 60);
    assert.equal(all[0]!.itemMode, 3);
  });

  it('maxId seeds the id counter past every stored party', async () => {
    assert.equal(await repo.maxId(), 1);
    // Fresh characters -- chars[0..2] are already in party 1, and a character
    // can only be in one party.
    const x = await makeChar('MaxA', 20);
    const y = await makeChar('MaxB', 21);
    await repo.create(party(7, [x, y]));
    assert.equal(await repo.maxId(), 7);
    await repo.remove(7);
    assert.equal(await repo.maxId(), 1);
  });

  it('replaceMembers rewrites the roster, keeping slots contiguous from 0', async () => {
    // Leadership handed to the second member -> the whole order shifts.
    await repo.replaceMembers(1, [chars[1]!, chars[0]!, chars[2]!]);
    const rows = await db('party_member').where({ party_id: 1 }).orderBy('slot');
    assert.deepEqual(rows.map((r: any) => [r.slot, r.character_id]), [
      [0, chars[1]], [1, chars[0]], [2, chars[2]],
    ]);
    const all = await repo.loadAll();
    assert.deepEqual(all[0]!.members, [chars[1]!, chars[0]!, chars[2]!]);
  });

  it('update patches only the named columns; an empty patch is a no-op', async () => {
    await repo.update(1, { exp: 150, level: 5 });
    await repo.update(1, {});
    const all = await repo.loadAll();
    assert.equal(all[0]!.exp, 150);
    assert.equal(all[0]!.level, 5);
    assert.equal(all[0]!.name, 'Troupe', 'untouched column preserved');
  });

  it('remove drops the party and cascades its members', async () => {
    await repo.remove(1);
    assert.deepEqual(await repo.loadAll(), []);
    const left = await db('party_member').where({ party_id: 1 });
    assert.equal(left.length, 0, 'party_member cascaded');
  });

  it('a character can only be in one party (UNIQUE(character_id))', async () => {
    await repo.create(party(2, [chars[0]!, chars[1]!]));
    await assert.rejects(() => repo.create(party(3, [chars[0]!, chars[2]!])));
    // The failed insert must not have left a half-written party behind.
    const all = await repo.loadAll();
    assert.deepEqual(all.map((p) => p.id), [2]);
    await repo.remove(2);
  });

  it('deleting a character cascades its party_member row', async () => {
    const gone = await makeChar('Doomed', 9);
    await repo.create(party(5, [chars[0]!, gone]));
    await db('characters').where({ id: gone }).delete();
    const all = await repo.loadAll();
    // The party row survives with one member -- PartyManager.hydrate prunes it.
    assert.deepEqual(all[0]!.members, [chars[0]!]);
    await repo.remove(5);
  });
});

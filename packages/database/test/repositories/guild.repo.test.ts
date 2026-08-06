/**
 * guild.repo.ts test -- roster round-trip, rank order, cooldown upsert, cascade.
 *
 * The invariants that matter: `loadAll` orders the roster by `member_lv` so the
 * master lands at index 0; `UNIQUE(character_id)` keeps a character in at most
 * one guild (`CMover::m_idGuild` is scalar); the rejoin lockout must overwrite,
 * because a later kick always supersedes an earlier leave.
 */

import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as knexModule from 'knex';
import type { Knex } from '../../src/types';
import {
  GuildRepository,
  type GuildMember,
  type GuildWithMembers,
} from '../../src/repositories/guild.repo';
import { up as up001 } from '../../src/migrations/001_initial';
import { up as up023 } from '../../src/migrations/023_guild';
// 025 adds `guild.win_point` (m_nWinPoint, guild.h:288), which `GuildRow` reads.
import { up as up025 } from '../../src/migrations/025_guild_war';

const knex = (knexModule as any).default || knexModule;

describe('guild.repo.ts', () => {
  let db: Knex;
  let repo: GuildRepository;
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

  function member(characterId: number, memberLv: number): GuildMember {
    return {
      characterId, memberLv, memberClass: 0, pay: 0, giveGold: 0, givePxp: 0,
      win: 0, lose: 0, surrender: 0, alias: '', selectedVoteId: 0,
    };
  }

  function guild(id: number, masterId: number, members: GuildMember[]): GuildWithMembers {
    return {
      id, name: `G${id}`, masterId, level: 1, logo: 0, contributionPxp: 0,
      gold: 0, notice: '', power: [255, 0, 0, 0, 0], penya: [0, 0, 0, 0, 0],
      win: 0, lose: 0, surrender: 0, winPoint: 0, members,
    };
  }

  before(async () => {
    db = knex({ client: 'better-sqlite3', connection: ':memory:', useNullAsDefault: true });
    await up001(db);
    await up023(db);
    await up025(db);
    await db('accounts').insert({ id: 1, username: 'a', password_hash: 'x' });
    for (let i = 0; i < 4; i++) chars.push(await makeChar(`C${i}`, i));
    repo = new GuildRepository(db);
  });

  after(async () => { await db.destroy(); });

  it('create + loadAll round-trips the guild and its roster, master first', async () => {
    // Insert rookie-first to prove loadAll orders by member_lv, not insert order.
    await repo.create({
      ...guild(1, chars[0]!, [member(chars[1]!, 4), member(chars[0]!, 0)]),
      name: 'Ivillis', level: 3, logo: 7, gold: 5000, notice: 'hi',
      power: [255, 16, 8, 4, 0], penya: [0, 100, 50, 25, 10],
    });
    const all = await repo.loadAll();
    assert.equal(all.length, 1);
    const g = all[0]!;
    assert.equal(g.name, 'Ivillis');
    assert.equal(g.masterId, chars[0]);
    assert.equal(g.level, 3);
    assert.equal(g.logo, 7);
    assert.equal(g.gold, 5000);
    assert.equal(g.notice, 'hi');
    assert.deepEqual(g.power, [255, 16, 8, 4, 0]);
    assert.deepEqual(g.penya, [0, 100, 50, 25, 10]);
    assert.deepEqual(g.members.map((m) => m.characterId), [chars[0], chars[1]], 'master first');
    assert.deepEqual(g.members.map((m) => m.memberLv), [0, 4]);
  });

  it('maxId seeds the id counter past every stored guild', async () => {
    assert.equal(await repo.maxId(), 1);
    await repo.create(guild(9, chars[2]!, [member(chars[2]!, 0)]));
    assert.equal(await repo.maxId(), 9);
    await repo.remove(9);
    assert.equal(await repo.maxId(), 1);
  });

  it('addMember appends at the given rank; removeMember drops it', async () => {
    await repo.addMember(1, chars[2]!, 2);
    let g = (await repo.loadAll())[0]!;
    assert.deepEqual(g.members.map((m) => [m.characterId, m.memberLv]), [
      [chars[0], 0], [chars[2], 2], [chars[1], 4],
    ]);
    await repo.removeMember(chars[2]!);
    g = (await repo.loadAll())[0]!;
    assert.deepEqual(g.members.map((m) => m.characterId), [chars[0], chars[1]]);
  });

  it('a character can only be in one guild (UNIQUE(character_id))', async () => {
    await assert.rejects(() => repo.addMember(1, chars[1]!, 3));
    await assert.rejects(() => repo.create(guild(4, chars[0]!, [member(chars[0]!, 0)])));
    // The failed insert must not have left a half-written guild behind.
    assert.deepEqual((await repo.loadAll()).map((g) => g.id), [1]);
  });

  it('update patches only the named columns; an empty patch is a no-op', async () => {
    await repo.update(1, { gold: 12345, level: 5 });
    await repo.update(1, {});
    const g = (await repo.loadAll())[0]!;
    assert.equal(g.gold, 12345);
    assert.equal(g.level, 5);
    assert.equal(g.notice, 'hi', 'untouched column preserved');
  });

  it('updateMember patches a roster entry, `class` included', async () => {
    await repo.updateMember(chars[1]!, { member_lv: 1, class: 2, alias: 'Vice', give_gold: 900 });
    await repo.updateMember(chars[1]!, {});
    const m = (await repo.loadAll())[0]!.members.find((x) => x.characterId === chars[1]);
    assert.ok(m);
    assert.equal(m.memberLv, 1);
    assert.equal(m.memberClass, 2);
    assert.equal(m.alias, 'Vice');
    assert.equal(m.giveGold, 900);
  });

  it('cooldown upserts (later lockout overwrites) and reads back 0 when absent', async () => {
    assert.equal(await repo.getCooldown(chars[3]!), 0);
    await repo.setCooldown(chars[3]!, 1000);
    assert.equal(await repo.getCooldown(chars[3]!), 1000);
    await repo.setCooldown(chars[3]!, 2000);
    assert.equal(await repo.getCooldown(chars[3]!), 2000);
    await repo.setCooldown(chars[2]!, 500);
    const all = await repo.loadAllCooldowns();
    assert.equal(all.size, 2);
    assert.equal(all.get(chars[3]!), 2000);
    assert.equal(all.get(chars[2]!), 500);
  });

  it('remove drops the guild and cascades its roster', async () => {
    await repo.remove(1);
    assert.deepEqual(await repo.loadAll(), []);
    const left = await db('guild_member').where({ guild_id: 1 });
    assert.equal(left.length, 0, 'guild_member cascaded');
  });

  it('deleting a character cascades its roster row and its cooldown', async () => {
    const gone = await makeChar('Doomed', 9);
    await repo.create(guild(6, chars[0]!, [member(chars[0]!, 0), member(gone, 4)]));
    await repo.setCooldown(gone, 777);
    await db('characters').where({ id: gone }).delete();
    // The guild row survives with one member -- GuildManager.hydrate prunes it.
    assert.deepEqual((await repo.loadAll())[0]!.members.map((m) => m.characterId), [chars[0]]);
    assert.equal(await repo.getCooldown(gone), 0, 'cooldown cascaded');
    await repo.remove(6);
  });
});

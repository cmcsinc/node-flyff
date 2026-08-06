/**
 * guildTable tests -- the `expCompanyTest` curve is 1-indexed by guild level,
 * and `guildMaxRankMembers(GUD_ROOKIE, ...)` is the whole-guild cap, not a flat
 * 80. Both are off-by-one / wrong-constant traps.
 * @module guildTable.test
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  GUILD_TABLE, MAX_GUILD_LEVEL, guildMaxMembers, guildMaxRankMembers,
} from '../src/guildTable';
import {
  GUD_MASTER, GUD_KINGPIN, GUD_CAPTAIN, GUD_SUPPORTER, GUD_ROOKIE, MAX_GM_LEVEL,
} from '@flyff/world-core';

describe('GUILD_TABLE', () => {
  it('is 1-indexed: index 0 is the unreachable level-0 row', () => {
    assert.deepEqual(GUILD_TABLE[0], { pxp: 0, penya: 0, maxMember: 0 });
  });

  it('index 1 is level 1 -- no requirement, 30 members', () => {
    assert.deepEqual(GUILD_TABLE[1], { pxp: 0, penya: 0, maxMember: 30 });
  });

  it('index 50 is the level-50 row', () => {
    assert.deepEqual(GUILD_TABLE[50], { pxp: 7075777, penya: 29759885, maxMember: 80 });
  });

  it('has 51 rows -> MAX_GUILD_LEVEL 50', () => {
    assert.equal(GUILD_TABLE.length, 51);
    assert.equal(MAX_GUILD_LEVEL, 50);
  });

  it('pxp and penya requirements are strictly increasing from level 2', () => {
    for (let l = 3; l <= MAX_GUILD_LEVEL; l++) {
      assert.ok(GUILD_TABLE[l].pxp > GUILD_TABLE[l - 1].pxp, `pxp at ${l}`);
      assert.ok(GUILD_TABLE[l].penya > GUILD_TABLE[l - 1].penya, `penya at ${l}`);
    }
  });

  it('maxMember never decreases as the guild levels', () => {
    for (let l = 2; l <= MAX_GUILD_LEVEL; l++) {
      assert.ok(GUILD_TABLE[l].maxMember >= GUILD_TABLE[l - 1].maxMember, `maxMember at ${l}`);
    }
  });
});

describe('guildMaxMembers()', () => {
  it('level 1 -> 30, level 50 -> 80', () => {
    assert.equal(guildMaxMembers(1), 30);
    assert.equal(guildMaxMembers(50), 80);
  });

  it('level 0 -> 0 (the unreachable row)', () => {
    assert.equal(guildMaxMembers(0), 0);
  });

  it('out-of-range levels -> 0, never undefined or NaN', () => {
    assert.equal(guildMaxMembers(51), 0);
    assert.equal(guildMaxMembers(999), 0);
    assert.equal(guildMaxMembers(-1), 0);
  });
});

describe('guildMaxRankMembers()', () => {
  it('fixed sm_anMaxMemberLvSize entries for master..supporter', () => {
    assert.equal(guildMaxRankMembers(GUD_MASTER, 1), 1);
    assert.equal(guildMaxRankMembers(GUD_KINGPIN, 1), 5);
    assert.equal(guildMaxRankMembers(GUD_CAPTAIN, 1), 10);
    assert.equal(guildMaxRankMembers(GUD_SUPPORTER, 1), 20);
  });

  it('the fixed ranks ignore guild level', () => {
    for (const lvl of [1, 25, 50]) {
      assert.equal(guildMaxRankMembers(GUD_MASTER, lvl), 1);
      assert.equal(guildMaxRankMembers(GUD_SUPPORTER, lvl), 20);
    }
  });

  it('GUD_ROOKIE returns the WHOLE-GUILD cap for that level, not a flat 80', () => {
    for (const lvl of [1, 3, 22, 49, 50]) {
      assert.equal(
        guildMaxRankMembers(GUD_ROOKIE, lvl), guildMaxMembers(lvl),
        `rookie cap at level ${lvl} must track guildMaxMembers (guild.cpp:499)`,
      );
    }
    assert.equal(guildMaxRankMembers(GUD_ROOKIE, 1), 30);
    assert.equal(guildMaxRankMembers(GUD_ROOKIE, 22), 50);
    assert.equal(guildMaxRankMembers(GUD_ROOKIE, 50), 80);
  });

  it('out-of-range rank -> 0', () => {
    assert.equal(guildMaxRankMembers(-1, 1), 0);
    assert.equal(guildMaxRankMembers(MAX_GM_LEVEL, 1), 0);
    assert.equal(guildMaxRankMembers(99, 50), 0);
  });

  it('rookie at an out-of-range level -> 0 (no cap leak)', () => {
    assert.equal(guildMaxRankMembers(GUD_ROOKIE, 0), 0);
    assert.equal(guildMaxRankMembers(GUD_ROOKIE, 999), 0);
  });
});

/**
 * guildText.ts test -- the ids themselves.
 *
 * A wrong TID does not fail loudly; it shows a confidently wrong sentence. The
 * checks here are the ones that catch the two realistic mistakes: a copy-paste
 * duplicate (two guards sharing one id by accident), and a value drifting out of
 * the block it belongs to.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as T from '../src/guildText';

/** Every exported id, as [name, value]. */
const entries = Object.entries(T).filter(([, v]) => typeof v === 'number') as [string, number][];

describe('guildText ids', () => {
  it('exports every TID the guild services reference', () => {
    // 35 distinct texts across roster, bank, contribution, war, and duel.
    assert.equal(entries.length, 35);
  });

  it('has no accidental duplicates -- except the four that C++ genuinely shares', () => {
    const byValue = new Map<number, string[]>();
    for (const [name, value] of entries) {
      byValue.set(value, [...(byValue.get(value) ?? []), name]);
    }
    const shared = [...byValue.entries()].filter(([, names]) => names.length > 1);
    assert.deepEqual(shared, [], 'each id is used under exactly one name');
  });

  it('keeps the COM* family in the community block (675-697)', () => {
    for (const [name, value] of entries) {
      if (!name.startsWith('TID_GAME_COM')) continue;
      assert.ok(value >= 675 && value <= 697, `${name} = ${value} is outside 675-697`);
    }
  });

  it('keeps the GUILD* family in 1241-1335', () => {
    for (const [name, value] of entries) {
      if (!name.startsWith('TID_GAME_GUILD')) continue;
      assert.ok(value >= 1241 && value <= 1335, `${name} = ${value} is outside 1241-1335`);
    }
  });

  it('pins the two strays that sit past the main guild run', () => {
    // These are why the block cannot be copied as a range: 1330-1333 are
    // unrelated texts, and these two sit after them.
    assert.equal(T.TID_GAME_GUILDWAROHTERLV6, 1334);
    assert.equal(T.TID_GAME_GUILDNOTINCLUDE, 1335);
  });

  it('pins the two outside both blocks', () => {
    assert.equal(T.TID_GAME_BATTLE_NOTGUILD, 1386);
    assert.equal(T.TID_DIAG_0011_01, 2908);
  });

  it('pins the war texts individually -- these are the nine declare gates', () => {
    assert.equal(T.TID_GAME_GUILDWARREQLV6, 1324);
    assert.equal(T.TID_GAME_GUILDWARSTILLNOWAR, 1325);
    assert.equal(T.TID_GAME_GUILDWARNOTHINGGUILD, 1326);
    assert.equal(T.TID_GAME_GUILDWARMASTEROFF, 1327);
    assert.equal(T.TID_GAME_GUILDWAROTHERWAR, 1328);
    assert.equal(T.TID_GAME_GUILDWARMEMBER10, 1329);
    assert.equal(T.TID_GAME_GUILDWARNOREQUEST, 1320);
    assert.equal(T.TID_GAME_GUILDWARNOFINDGUILD, 1321);
    assert.equal(T.TID_GAME_COMNOHAVECOM, 677);
    assert.equal(T.TID_GAME_COMDELNOTKINGPIN, 676);
  });

  it('every id is a positive integer', () => {
    for (const [name, value] of entries) {
      assert.ok(Number.isInteger(value) && value > 0, `${name} = ${value}`);
    }
  });
});

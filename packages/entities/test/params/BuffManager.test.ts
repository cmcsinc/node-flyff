/**
 * BuffManager -- the timed DST buff lifecycle layer over ParamModel. Verifies
 * add (applies effects), overwrite dispatch (refresh/replace/ignore), cap
 * eviction, per-second expiry, clear, and CHRSTATE bit-flag handling.
 *
 * Pure data -- no sockets. S→C snapshot is a separate concern.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ParamModel } from '@flyff/entities';
import { BuffManager, MAX_SKILL_BUFF, BUFF_SKILL } from '@flyff/entities';
import { DST, CHG_SENTINEL } from '@flyff/entities';
import type { DstEffect } from '@flyff/entities';

function buffEffect(dst: number, adj: number, chg: number = CHG_SENTINEL): DstEffect {
  return { dst, adj, chg };
}

describe('BuffManager.addSkillBuff (apply + overwrite)', () => {
  it('applies DST effects additively on add', () => {
    const params = new ParamModel();
    const buffs = new BuffManager(params);
    // +20 STR buff for 30s.
    const out = buffs.addSkillBuff(100, 1, 30_000, [buffEffect(DST.STR, 20)], 0);
    assert.equal(out, 'added');
    assert.equal(params.get(DST.STR, 15), 35); // base 15 + 20
    assert.equal(buffs.has(100), true);
  });

  it('same-level re-cast refreshes duration without re-applying effects', () => {
    const params = new ParamModel();
    const buffs = new BuffManager(params);
    buffs.addSkillBuff(100, 1, 30_000, [buffEffect(DST.STR, 20)], 0);

    const out = buffs.addSkillBuff(100, 1, 30_000, [buffEffect(DST.STR, 20)], 10_000);
    assert.equal(out, 'refreshed');
    assert.equal(buffs.size, 1);
    // STR unchanged -- no double-apply.
    assert.equal(params.get(DST.STR, 15), 35);
    // Deadline extended: started at t=10k, +30s => not expired at t=39_999.
    buffs.tick(39_999);
    assert.equal(buffs.size, 1);
  });

  it('refresh takes max(remaining, new) when new is shorter', () => {
    const params = new ParamModel();
    const buffs = new BuffManager(params);
    buffs.addSkillBuff(100, 1, 60_000, [buffEffect(DST.STR, 20)], 0); // expires at 60k
    // Re-cast at t=50k with a 10s duration (would expire at 60k) -- remaining 10k wins.
    buffs.addSkillBuff(100, 1, 10_000, [buffEffect(DST.STR, 20)], 50_000);
    buffs.tick(59_999);
    assert.equal(buffs.size, 1, 'buff survives past the shorter new duration');
  });

  it('higher-level re-cast replaces (reset old, apply new)', () => {
    const params = new ParamModel();
    const buffs = new BuffManager(params);
    buffs.addSkillBuff(100, 1, 30_000, [buffEffect(DST.STR, 20)], 0); // +20 STR
    const out = buffs.addSkillBuff(100, 2, 30_000, [buffEffect(DST.STR, 50)], 0); // +50 STR
    assert.equal(out, 'replaced');
    assert.equal(params.get(DST.STR, 15), 65); // 15 + 50, not 15 + 20 + 50
    assert.equal(buffs.size, 1);
  });

  it('lower-level re-cast is ignored (stronger active buff wins)', () => {
    const params = new ParamModel();
    const buffs = new BuffManager(params);
    buffs.addSkillBuff(100, 3, 30_000, [buffEffect(DST.STR, 50)], 0); // +50 STR L3
    const out = buffs.addSkillBuff(100, 1, 30_000, [buffEffect(DST.STR, 20)], 0); // +20 STR L1
    assert.equal(out, 'ignored');
    assert.equal(params.get(DST.STR, 15), 65); // still L3's +50
    assert.equal(buffs.size, 1);
  });

  it('two distinct skill buffs stack additively', () => {
    const params = new ParamModel();
    const buffs = new BuffManager(params);
    buffs.addSkillBuff(100, 1, 30_000, [buffEffect(DST.STR, 20)], 0);
    buffs.addSkillBuff(200, 1, 30_000, [buffEffect(DST.STR, 10)], 0);
    assert.equal(params.get(DST.STR, 15), 45); // 15 + 20 + 10
  });
});

describe('BuffManager.remove + tick (expire)', () => {
  it('remove reverses the effects', () => {
    const params = new ParamModel();
    const buffs = new BuffManager(params);
    buffs.addSkillBuff(100, 1, 30_000, [buffEffect(DST.STR, 20)], 0);
    const removed = buffs.remove(100);
    assert.ok(removed);
    assert.equal(params.get(DST.STR, 15), 15); // back to base
    assert.equal(buffs.has(100), false);
    assert.equal(buffs.remove(100), undefined);
  });

  it('tick expires only buffs past their deadline and reverses them', () => {
    const params = new ParamModel();
    const buffs = new BuffManager(params);
    buffs.addSkillBuff(100, 1, 10_000, [buffEffect(DST.STR, 20)], 0); // expires 10k
    buffs.addSkillBuff(200, 1, 30_000, [buffEffect(DST.STR, 10)], 0); // expires 30k

    const expired = buffs.tick(20_000);
    assert.equal(expired.length, 1);
    assert.equal(expired[0]!.skillId, 100);
    assert.equal(buffs.has(100), false);
    assert.equal(buffs.has(200), true);
    assert.equal(params.get(DST.STR, 15), 25); // 15 + 10 (only 200 remains)
  });

  it('tick is a no-op before any deadline', () => {
    const buffs = new BuffManager(new ParamModel());
    buffs.addSkillBuff(100, 1, 30_000, [buffEffect(DST.STR, 20)], 0);
    assert.equal(buffs.tick(29_999).length, 0);
    assert.equal(buffs.size, 1);
  });
});

describe('BuffManager cap + clear', () => {
  it('evicts the oldest buff when the skill-buff cap is reached', () => {
    const params = new ParamModel();
    const buffs = new BuffManager(params);
    for (let i = 1; i <= MAX_SKILL_BUFF; i++) {
      buffs.addSkillBuff(i, 1, 30_000, [buffEffect(DST.STR, 1)], 0);
    }
    assert.equal(buffs.size, MAX_SKILL_BUFF);
    assert.equal(buffs.has(1), true);

    // One over cap -> oldest (id 1) evicted.
    buffs.addSkillBuff(999, 1, 30_000, [buffEffect(DST.STR, 1)], 0);
    assert.equal(buffs.size, MAX_SKILL_BUFF);
    assert.equal(buffs.has(1), false, 'oldest evicted');
    assert.equal(buffs.has(999), true);
  });

  it('clear removes every buff and reverses all effects', () => {
    const params = new ParamModel();
    const buffs = new BuffManager(params);
    buffs.addSkillBuff(100, 1, 30_000, [buffEffect(DST.STR, 20)], 0);
    buffs.addSkillBuff(200, 1, 30_000, [buffEffect(DST.DEX, 10)], 0);

    const cleared = buffs.clear();
    assert.equal(cleared.length, 2);
    assert.equal(buffs.size, 0);
    assert.equal(params.get(DST.STR, 15), 15);
    assert.equal(params.get(DST.DEX, 15), 15);
  });
});

describe('BuffManager DST_CHRSTATE (bit-flag buffs)', () => {
  it('ORs CHRSTATE bits and clears only those bits on remove', () => {
    const params = new ParamModel();
    const buffs = new BuffManager(params);
    // Stun bit on, then poison bit on -- both set (bitwise OR).
    buffs.addSkillBuff(100, 1, 30_000, [buffEffect(DST.CHRSTATE, 0x01)], 0);
    buffs.addSkillBuff(200, 1, 30_000, [buffEffect(DST.CHRSTATE, 0x02)], 0);
    assert.equal(params.get(DST.CHRSTATE, 0), 0x03);

    buffs.remove(100); // clear stun bit only
    assert.equal(params.get(DST.CHRSTATE, 0), 0x02);
  });
});

describe('BuffManager type tag', () => {
  it('tags active buffs as BUFF_SKILL', () => {
    const buffs = new BuffManager(new ParamModel());
    buffs.addSkillBuff(100, 1, 30_000, [buffEffect(DST.STR, 20)], 0);
    const removed = buffs.remove(100);
    assert.equal(removed!.type, BUFF_SKILL);
  });
});

describe('BuffManager.tickDots (DoT)', () => {
  it('fires no DoT when the buff has no dot payload', () => {
    const buffs = new BuffManager(new ParamModel());
    buffs.addSkillBuff(100, 1, 10_000, [buffEffect(DST.STR, 20)], 0);
    assert.equal(buffs.tickDots(5_000).length, 0);
  });

  it('fires the DoT once per interval and advances the cursor', () => {
    const buffs = new BuffManager(new ParamModel());
    // 10 damage every 2 s, first tick at 2_000 (nextTick seeded at cast+interval).
    buffs.addSkillBuff(200, 1, 10_000, [], 0, { damage: 10, intervalMs: 2_000, nextTickMs: 2_000 });

    assert.equal(buffs.tickDots(1_999).length, 0, 'before first interval: no tick');
    let due = buffs.tickDots(2_000);
    assert.equal(due.length, 1);
    assert.equal(due[0]!.damage, 10);

    // 1 s later -- still before the next interval.
    assert.equal(buffs.tickDots(2_999).length, 0);
    due = buffs.tickDots(4_000);
    assert.equal(due.length, 1);
    assert.equal(due[0]!.damage, 10);
  });

  it('does not burst-fire after a stalled tick (advances by whole intervals)', () => {
    const buffs = new BuffManager(new ParamModel());
    buffs.addSkillBuff(200, 1, 10_000, [], 0, { damage: 10, intervalMs: 2_000, nextTickMs: 2_000 });
    // Stalled 5 s past the first tick (t=7_000) -> one tick, cursor jumps to 8_000.
    const due = buffs.tickDots(7_000);
    assert.equal(due.length, 1, 'no burst');
    // Next tick now due at 8_000.
    assert.equal(buffs.tickDots(7_999).length, 0);
    assert.equal(buffs.tickDots(8_000).length, 1);
  });

  it('sums multiple DoT buffs in one pass', () => {
    const buffs = new BuffManager(new ParamModel());
    buffs.addSkillBuff(200, 1, 10_000, [], 0, { damage: 10, intervalMs: 2_000, nextTickMs: 2_000 });
    buffs.addSkillBuff(300, 1, 10_000, [], 0, { damage: 15, intervalMs: 2_000, nextTickMs: 2_000 });
    const due = buffs.tickDots(2_000);
    assert.equal(due.length, 2);
    assert.equal(due[0]!.damage + due[1]!.damage, 25);
  });
});


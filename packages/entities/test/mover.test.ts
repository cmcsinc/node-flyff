/**
 * CMover param model + buff container + stun gate. Verifies a debuff applied to
 * a monster lands in the DST pool, is read by the stun gate, and reverses on
 * expiry.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CMover, DST, CHRSTATE_BITS } from '@flyff/entities';
import type { MoverSpawnSource } from '@flyff/entities';

const SRC: MoverSpawnSource = {
  modelIndex: 0, key: '', name: 'TestMob', level: 5, hp: 100,
};

function makeMover(): CMover {
  return CMover.spawn(1, SRC, { x: 0, y: 0, z: 0 }, 1);
}

describe('CMover param model + buffs', () => {
  it('has an empty DST pool until a buff applies', () => {
    const m = makeMover();
    assert.equal(m.m_params.get(DST.STR, 0), 0);
    assert.equal(m.m_buffs.size, 0);
  });

  it('applies a DST debuff into the mover pool', () => {
    const m = makeMover();
    m.m_buffs.addSkillBuff(100, 1, 10_000, [{ dst: DST.ADJDEF, adj: -50 }], 0);
    assert.equal(m.m_params.get(DST.ADJDEF, 0), -50);
    assert.equal(m.m_buffs.has(100), true);
  });

  it('isStunned reflects the CHRSTATE stun bit set by a debuff', () => {
    const m = makeMover();
    assert.equal(m.isStunned(), false);
    m.m_buffs.addSkillBuff(200, 1, 5_000, [{ dst: DST.CHRSTATE, adj: CHRSTATE_BITS.STUN }], 0);
    assert.equal(m.isStunned(), true);
  });

  it('reverses the debuff + clears stun on expiry', () => {
    const m = makeMover();
    m.m_buffs.addSkillBuff(200, 1, 1_000, [{ dst: DST.CHRSTATE, adj: CHRSTATE_BITS.STUN }], 0);
    assert.equal(m.isStunned(), true);
    const expired = m.m_buffs.tick(2_000);
    assert.equal(expired.length, 1);
    assert.equal(m.isStunned(), false, 'stun cleared after expiry');
  });

  it('sleep bit also gates (isStunned covers STUN | SLEEP)', () => {
    const m = makeMover();
    m.m_buffs.addSkillBuff(300, 1, 5_000, [{ dst: DST.CHRSTATE, adj: CHRSTATE_BITS.SLEEP }], 0);
    assert.equal(m.isStunned(), true);
  });
});

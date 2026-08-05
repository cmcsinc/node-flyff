/**
 * `getAttackRange` tests -- port of `CMover::GetAttackRange`
 * (`_Common/MoverMsg.cpp:140-166`). Verifies the AR_* -> metres table verbatim,
 * the `default: 0.0f` arm for unknown/absent enums, and the DST_HAWKEYE_RATE
 * scaling (`fAttRange * (rate + 100) / 100`).
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { AR, getAttackRange, RANGE_HITBOX_SLACK } from '../../src/constants/attackRange';
import { ParamModel } from '../../src/params/ParamModel';
import { DST } from '../../src/constants/dst';

describe('getAttackRange', () => {
  it('maps every AR_* to its C++ metre value', () => {
    assert.equal(getAttackRange(AR.SHORT), 2);
    assert.equal(getAttackRange(AR.LONG), 3);
    assert.equal(getAttackRange(AR.FAR), 4);
    assert.equal(getAttackRange(AR.RANGE), 10);
    assert.equal(getAttackRange(AR.WAND), 15);
    assert.equal(getAttackRange(AR.HRANGE), 6);
    assert.equal(getAttackRange(AR.HWAND), 18);
  });

  it('returns 0 for an absent or unknown enum (C++ default arm)', () => {
    assert.equal(getAttackRange(undefined), 0);
    assert.equal(getAttackRange(0), 0);
    assert.equal(getAttackRange(99), 0);
  });

  it('scales by DST_HAWKEYE_RATE', () => {
    const params = new ParamModel();
    params.setDestParam(DST.HAWKEYE_RATE, 50);
    // AR_RANGE 10 m * (50 + 100) / 100 = 15 m
    assert.equal(getAttackRange(AR.RANGE, params), 15);
  });

  it('ignores a zero/negative hawkeye rate and never scales a 0 reach', () => {
    const params = new ParamModel();
    assert.equal(getAttackRange(AR.LONG, params), 3);
    params.setDestParam(DST.HAWKEYE_RATE, -20);
    assert.equal(getAttackRange(AR.LONG, params), 3, 'negative rate cannot shrink reach');
    assert.equal(getAttackRange(0, params), 0, '0 reach stays 0 regardless of rate');
  });

  it('exposes a positive hitbox slack (stands in for the two model radii)', () => {
    assert.ok(RANGE_HITBOX_SLACK > 0);
  });
});

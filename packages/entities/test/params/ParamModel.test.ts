/**
 * ParamModel tests -- port of the C++ `m_adjParamAry`/`m_chgParamAry` model.
 * Verifies GetParam precedence (chg > adj+def > def), additive accumulation,
 * CHRSTATE bitwise-OR, pseudo-param fan-out, and equip apply/remove round-trip.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ParamModel, EMPTY_PARAM_VIEW } from '../../src/params/ParamModel';
import { DST, MAX_ADJPARAMARY } from '../../src/constants/dst';

describe('ParamModel.get', () => {
  it('returns the default when nothing is set', () => {
    const p = new ParamModel();
    assert.equal(p.get(DST.STR, 15), 15);
    assert.equal(p.get(6, 5), 5); // in-range unused slot
  });

  it('returns default+adj when an additive adjustment is set', () => {
    const p = new ParamModel();
    p.setDestParam(DST.STR, 5);
    assert.equal(p.get(DST.STR, 15), 20);
  });

  it('chg override wins over base+adj', () => {
    const p = new ParamModel();
    p.setDestParam(DST.STR, 5);
    p.setDestParam(DST.STR, 0, 99); // adj=0 -> chg-only override
    assert.equal(p.get(DST.STR, 15), 99);
  });

  it('out-of-range dst returns the default unchanged', () => {
    const p = new ParamModel();
    p.setDestParam(MAX_ADJPARAMARY + 5, 10); // no-op (not pseudo)
    assert.equal(p.get(MAX_ADJPARAMARY + 5, 7), 7);
  });
});

describe('ParamModel.setDestParam', () => {
  it('accumulates additive adjustments', () => {
    const p = new ParamModel();
    p.setDestParam(DST.ADJDEF, 10);
    p.setDestParam(DST.ADJDEF, 5);
    assert.equal(p.get(DST.ADJDEF, 0), 15);
  });

  it('CHRSTATE is bitwise-OR, not additive', () => {
    const p = new ParamModel();
    p.setDestParam(DST.CHRSTATE, 0x02);
    p.setDestParam(DST.CHRSTATE, 0x08);
    assert.equal(p.get(DST.CHRSTATE, 0), 0x0a);
  });
});

describe('ParamModel.resetDestParam', () => {
  it('subtracts additive adjustments', () => {
    const p = new ParamModel();
    p.setDestParam(DST.ADJDEF, 20);
    p.resetDestParam(DST.ADJDEF, 5);
    assert.equal(p.get(DST.ADJDEF, 0), 15);
  });

  it('clears CHRSTATE bits with &= ~val', () => {
    const p = new ParamModel();
    p.setDestParam(DST.CHRSTATE, 0x0a);
    p.resetDestParam(DST.CHRSTATE, 0x02);
    assert.equal(p.get(DST.CHRSTATE, 0), 0x08);
  });

  it('clears a chg override back to the sentinel', () => {
    const p = new ParamModel();
    p.setDestParam(DST.STR, 0, 99);
    p.resetDestParam(DST.STR, 0, 99);
    assert.equal(p.get(DST.STR, 15), 15);
  });
});

describe('ParamModel pseudo-params', () => {
  it('DST_STAT_ALLUP fans out to STR/DEX/INT/STA', () => {
    const p = new ParamModel();
    p.setDestParam(DST.STAT_ALLUP, 3);
    assert.equal(p.get(DST.STR, 0), 3);
    assert.equal(p.get(DST.DEX, 0), 3);
    assert.equal(p.get(DST.INT, 0), 3);
    assert.equal(p.get(DST.STA, 0), 3);
  });

  it('DST_HPDMG_UP fans out to HP_MAX + CHR_DMG', () => {
    const p = new ParamModel();
    p.setDestParam(DST.HPDMG_UP, 20);
    assert.equal(p.get(DST.HP_MAX, 0), 20);
    assert.equal(p.get(DST.CHR_DMG, 0), 20);
  });

  it('DST_RESIST_ALL fans out to all 5 element resists', () => {
    const p = new ParamModel();
    p.setDestParam(DST.RESIST_ALL, 5);
    assert.equal(p.get(DST.RESIST_FIRE, 0), 5);
    assert.equal(p.get(DST.RESIST_WATER, 0), 5);
    assert.equal(p.get(DST.RESIST_EARTH, 0), 5);
  });
});

describe('ParamModel applyEffects / removeEffects (equip round-trip)', () => {
  it('applies then removes a +STR/+HP_MAX ring back to baseline', () => {
    const p = new ParamModel();
    const ring = [
      { dst: DST.STR, adj: 5 },
      { dst: DST.HP_MAX, adj: 50 },
    ];
    p.applyEffects(ring);
    assert.equal(p.get(DST.STR, 15), 20);
    assert.equal(p.get(DST.HP_MAX, 100), 150);
    p.removeEffects(ring);
    assert.equal(p.get(DST.STR, 15), 15);
    assert.equal(p.get(DST.HP_MAX, 100), 100);
  });
});

describe('EMPTY_PARAM_VIEW', () => {
  it('always returns the default', () => {
    assert.equal(EMPTY_PARAM_VIEW.get(DST.STR, 42), 42);
    assert.equal(EMPTY_PARAM_VIEW.get(DST.HP_MAX, 0), 0);
  });
});

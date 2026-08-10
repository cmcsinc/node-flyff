import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { expThreshold, expToPercent, percentToExp, formatPercent } from '../lib/exp-percent';

// Level 20's bar is EXP_TABLE[21].nExp1 = 7840 (expTable.inc row 21).
const L20_BAR = 7840;

describe('exp-percent', () => {
  it("reads the next level's raw nExp1 as the bar", () => {
    assert.equal(expThreshold(20), L20_BAR);
    assert.equal(expThreshold(1), 14); // EXP_TABLE[2].nExp1
  });

  it('converts raw within-level exp to percent', () => {
    assert.equal(expToPercent('0', 20), 0);
    assert.equal(expToPercent(String(L20_BAR / 2), 20), 50);
    assert.equal(expToPercent(String(L20_BAR), 20), 100);
  });

  it('converts percent back to raw exp', () => {
    assert.equal(percentToExp(0, 20), '0');
    assert.equal(percentToExp(50, 20), String(L20_BAR / 2));
    assert.equal(percentToExp(100, 20), String(L20_BAR));
  });

  it('clamps out-of-range and non-finite input', () => {
    assert.equal(percentToExp(150, 20), String(L20_BAR));
    assert.equal(percentToExp(-5, 20), '0');
    assert.equal(percentToExp(Number.NaN, 20), '0');
    assert.equal(expToPercent('999999999', 20), 100);
    assert.equal(expToPercent('not-a-number', 20), 0);
  });

  it('round-trips percent → raw → percent within rounding', () => {
    for (const p of [0, 1, 12.5, 33.33, 99, 100]) {
      const raw = percentToExp(p, 20);
      assert.ok(Math.abs(expToPercent(raw, 20) - p) < 0.02, `p=${String(p)} raw=${raw}`);
    }
  });

  it('treats the level cap as having no bar', () => {
    // v19 ships no progression past L150; index 200 is out of the table.
    assert.equal(expThreshold(199), 0);
    assert.equal(expToPercent('500', 199), 0);
    assert.equal(percentToExp(50, 199), '0');
  });

  it('formats percent without trailing zeros', () => {
    assert.equal(formatPercent(0), '0');
    assert.equal(formatPercent(50), '50');
    assert.equal(formatPercent(33.333333), '33.33');
  });
});

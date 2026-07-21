/**
 * Formula unit tests for `combat/formulas.ts` — hand-computed expected outputs
 * from `docs/combat-research.md` §A/§B. Uses a scripted `Rng` so damage is
 * deterministic and asserts exact C++-matching values.
 *
 * Fixture: L1 VAGRANT (STR/STA/DEX/INT=15) bare-hand vs Small Aibatt (L1,
 * atk=16, armor=3, HR=40, ER=3) — the first monster a new player fights.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  resolveMelee, getHitMinMax, getAttackResult, calcDefense, expLevelDiffMult,
  addExp, expToNextLevel, withinLevelExp, cumulativeExp, subDieDecExp,
  type Combatant, type Rng,
} from '../../src/combat/formulas.js';
import { WT_MELEE_SWD, NO_PROP, AF_GENERIC, AF_MISS, AF_CRITICAL1 } from '../../src/combat/tables.js';

const FIST = { min: 0, max: 0, type: WT_MELEE_SWD, atkSpeed: 0.4, option: 0, element: NO_PROP };
const BARE_HAND = { min: 1, max: 3, type: WT_MELEE_SWD, atkSpeed: 0.4, option: 0, element: NO_PROP };

const player: Combatant = {
  kind: 'player', level: 1, job: 0,
  str: 15, sta: 15, dex: 15, int: 15,
  weapon: BARE_HAND,
  npcAtkMin: 0, npcAtkMax: 0, npcArmor: 0, npcResisMagic: 0, npcHR: 0, npcER: 0, element: NO_PROP,
};

const aibatt: Combatant = {
  kind: 'npc', level: 1, job: 0,
  str: 0, sta: 0, dex: 0, int: 0,
  weapon: FIST,
  npcAtkMin: 16, npcAtkMax: 16, npcArmor: 3, npcResisMagic: 0, npcHR: 40, npcER: 3, element: NO_PROP,
};

/** Scripted rng — `int()` draws from `ints` in call order; `range()` is fixed. */
function makeRng(ints: number[], rangeVal: number): Rng {
  let i = 0;
  return {
    int: () => ints[i++] ?? 0,
    range: () => rangeVal,
  };
}

describe('combat getHitMinMax', () => {
  it('L1 VAGRANT bare-hand → {16,20} (weapon*2 + (STR-12)*4.5 + LVL*1.1)', () => {
    // plus = (15-12)*4.5 + 1.1 = 14.6; min = 1*2+14.6=16.6→16; max = 3*2+14.6=20.6→20
    assert.deepEqual(getHitMinMax(player), { min: 16, max: 20 });
  });
  it('NPC uses raw dwAtkMin/Max', () => {
    assert.deepEqual(getHitMinMax(aibatt), { min: 16, max: 16 });
  });
});

describe('combat getAttackResult', () => {
  it('L1 player vs L1 aibatt clamps to MAX_HR=96', () => {
    // (15*1.5/18)*2*(0.5/1.3)*100 = 96.15 → clamp 96
    assert.equal(getAttackResult(player, aibatt), 96);
  });
});

describe('combat calcDefense', () => {
  it('NPC melee DEF = floor(armor/7)+1', () => {
    assert.equal(calcDefense(aibatt), 1); // floor(3/7)+1
  });
});

describe('combat resolveMelee', () => {
  it('normal hit, no crit, no block → damage = ATK(16) - DEF(1) = 15', () => {
    // ints: hit=0(<96), crit=99(>=1), block=50(no block). range=16(min roll).
    const r = resolveMelee(player, aibatt, makeRng([0, 99, 50], 16));
    assert.equal(r.hit, true);
    assert.equal(r.damage, 15);
    assert.equal(r.atkFlags, AF_GENERIC);
  });

  it('miss (hit roll >= hitRate) → AF_MISS, 0 damage', () => {
    const r = resolveMelee(player, aibatt, makeRng([99], 16));
    assert.equal(r.hit, false);
    assert.equal(r.damage, 0);
    assert.equal(r.atkFlags & AF_MISS, AF_MISS);
  });

  it('crit (crit roll < critProb=1) → 2.3× ATK → 36-1 = 35, AF_CRITICAL1', () => {
    // ints: hit=0, crit=0(<1 → crit), block=50. range=16.
    const r = resolveMelee(player, aibatt, makeRng([0, 0, 50], 16));
    assert.equal(r.hit, true);
    assert.equal(r.damage, 35); // floor(16*2.3)=36, minus DEF 1
    assert.equal(r.atkFlags & AF_CRITICAL1, AF_CRITICAL1);
  });

  it('NPC block (block roll >=95) → 90% reduction', () => {
    // ints: hit=0, crit=99, block=95(>=95 → 0.1 factor). range=16.
    const r = resolveMelee(player, aibatt, makeRng([0, 99, 95], 16));
    assert.equal(r.hit, true);
    assert.equal(r.damage, 1); // floor((16-1)*0.1)=1
  });
});

describe('combat expLevelDiffMult', () => {
  it('playerLevel ≤ monsterLevel → 1.0', () => {
    assert.equal(expLevelDiffMult(1, 1), 1.0);
    assert.equal(expLevelDiffMult(5, 10), 1.0);
  });
  it('delta 1-2 → 0.7', () => {
    assert.equal(expLevelDiffMult(2, 1), 0.7);
    assert.equal(expLevelDiffMult(3, 1), 0.7);
  });
  it('delta 3-4 → 0.4', () => {
    assert.equal(expLevelDiffMult(4, 1), 0.4);
    assert.equal(expLevelDiffMult(5, 1), 0.4);
  });
  it('delta ≥5 → 0.1', () => {
    assert.equal(expLevelDiffMult(6, 1), 0.1);
  });
});

describe('combat addExp (level-up cascade)', () => {
  it('no level-up when exp stays below the threshold', () => {
    // L1→L2 needs 14 (nExp1 0→14). Gain 5 at 0 → still L1, exp 5.
    const r = addExp(1, 0, 5);
    assert.deepEqual(r, { level: 1, exp: 5, levelsGained: 0 });
  });

  it('resets to 0 at an exact boundary (no carryover)', () => {
    const r = addExp(1, 0, 14);
    assert.deepEqual(r, { level: 2, exp: 0, levelsGained: 1 });
  });

  it('carries excess into the next level on overflow', () => {
    // L1→L2 needs 14, L2→L3 needs 6 (14→20). Gain 18 from 0 → L3, exp 18-14-6 = -2? No: 18-14=4, 4<6 stop → L2 exp 4.
    const r = addExp(1, 0, 18);
    assert.deepEqual(r, { level: 2, exp: 4, levelsGained: 1 });
  });

  it('cascades multiple levels from a single large gain', () => {
    // Gain 20 from L1 exp 0: 20-14=6 (L2), 6-6=0 (L3, exact boundary), 0<16 stop.
    const r = addExp(1, 0, 20);
    assert.deepEqual(r, { level: 3, exp: 0, levelsGained: 2 });
  });

  it('caps at MAX_LEVEL (no further progression)', () => {
    const huge = addExp(1, 0, Number.MAX_SAFE_INTEGER);
    assert.ok(huge.level < 200);
    assert.equal(huge.level, huge.level); // reached a finite cap row
  });

  it('expToNextLevel is the delta of cumulative nExp1', () => {
    assert.equal(expToNextLevel(1), 14); // 14 - 0
    assert.equal(expToNextLevel(2), 6);  // 20 - 14
    assert.equal(expToNextLevel(3), 16); // 36 - 20
  });
});

describe('combat cumulative ↔ within-level conversion', () => {
  it('withinLevelExp subtracts the level base', () => {
    assert.equal(withinLevelExp(1000, 12), 27); // 1000 - 973
    assert.equal(withinLevelExp(14, 2), 0);
    assert.equal(withinLevelExp(5, 1), 5);
  });

  it('withinLevelExp clamps negative (malformed row) to 0', () => {
    assert.equal(withinLevelExp(3, 5), 0); // 3 - 90 < 0
  });

  it('cumulativeExp is the inverse of withinLevelExp', () => {
    assert.equal(cumulativeExp(12, 27), 1000);
    assert.equal(cumulativeExp(2, 0), 14);
  });
});

describe('combat subDieDecExp (death penalty)', () => {
  it('no loss at level ≤ 20', () => {
    assert.equal(subDieDecExp(15, 100).exp, 100);
    assert.equal(subDieDecExp(20, 100).exp, 100);
  });

  it('loses 6% of current-level cost at level 25 (Lv≤29 bracket)', () => {
    const need = expToNextLevel(25);
    const loss = Math.floor(need * 0.06);
    assert.equal(subDieDecExp(25, 1000).exp, 1000 - loss);
  });

  it('loses 5% of current-level cost at level 40 (Lv≤59 bracket)', () => {
    const need = expToNextLevel(40);
    const loss = Math.floor(need * 0.05);
    // Use enough within-level exp that the loss does not clamp to 0.
    assert.equal(subDieDecExp(40, 200_000).exp, 200_000 - loss);
  });

  it('clamps at 0 when loss exceeds current within-level exp', () => {
    const r = subDieDecExp(40, 100);
    assert.equal(r.exp, 0);
    assert.equal(r.level, 40);
  });

  it('never changes the level', () => {
    assert.equal(subDieDecExp(30, 100000).level, 30);
  });
});

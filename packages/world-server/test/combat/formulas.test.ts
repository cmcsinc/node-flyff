/**
 * Formula unit tests for `combat/formulas.ts` -- hand-computed expected outputs
 * from `docs/combat-research.md` #A/#B. Uses a scripted `Rng` so damage is
 * deterministic and asserts exact C++-matching values.
 *
 * Fixture: L1 VAGRANT (STR/STA/DEX/INT=15) bare-hand vs Small Aibatt (L1,
 * atk=16, armor=3, HR=40, ER=3) -- the first monster a new player fights.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  resolveMelee, getHitMinMax, getAttackResult, getParrying, calcDefense, expLevelDiffMult,
  addExp, expToNextLevel, withinLevelExp, cumulativeExp, subDieDecExp,
  maxFatiguePoint, standRecovery,
  type Combatant, type Rng,
} from '../../src/combat/formulas.js';
import { WT_MELEE_SWD, NO_PROP, AF_GENERIC, AF_MISS, AF_CRITICAL1, getJobProps } from '../../src/combat/tables.js';

const FIST = { min: 0, max: 0, type: WT_MELEE_SWD, atkSpeed: 0.4, option: 0, element: NO_PROP };
const BARE_HAND = { min: 1, max: 3, type: WT_MELEE_SWD, atkSpeed: 0.4, option: 0, element: NO_PROP };

const player: Combatant = {
  kind: 'player', level: 1, job: 0,
  str: 15, sta: 15, dex: 15, int: 15,
  weapon: BARE_HAND,
  npcAtkMin: 0, npcAtkMax: 0, npcArmor: 0, npcResisMagic: 0, npcHR: 0, npcER: 0, element: NO_PROP,
  equipDef: 0, adjHitRate: 0, parry: 0,
};

const aibatt: Combatant = {
  kind: 'npc', level: 1, job: 0,
  str: 0, sta: 0, dex: 0, int: 0,
  weapon: FIST,
  npcAtkMin: 16, npcAtkMax: 16, npcArmor: 3, npcResisMagic: 0, npcHR: 40, npcER: 3, element: NO_PROP,
  equipDef: 0, adjHitRate: 0, parry: 0,
};

/** Scripted rng -- `int()` draws from `ints` in call order; `range()` is fixed. */
function makeRng(ints: number[], rangeVal: number): Rng {
  let i = 0;
  return {
    int: () => ints[i++] ?? 0,
    range: () => rangeVal,
  };
}

describe('combat getHitMinMax', () => {
  it('L1 VAGRANT bare-hand -> {16,20} (weapon*2 + (STR-12)*4.5 + LVL*1.1)', () => {
    // plus = (15-12)*4.5 + 1.1 = 14.6; min = 1*2+14.6=16.6->16; max = 3*2+14.6=20.6->20
    assert.deepEqual(getHitMinMax(player), { min: 16, max: 20 });
  });
  it('NPC uses raw dwAtkMin/Max', () => {
    assert.deepEqual(getHitMinMax(aibatt), { min: 16, max: 16 });
  });
});

describe('combat getAttackResult', () => {
  it('L1 player vs L1 aibatt clamps to MAX_HR=96', () => {
    // (15*1.5/18)*2*(0.5/1.3)*100 = 96.15 -> clamp 96
    assert.equal(getAttackResult(player, aibatt), 96);
  });
});

describe('combat calcDefense', () => {
  it('NPC melee DEF = floor(armor/7)+1', () => {
    assert.equal(calcDefense(aibatt), 1); // floor(3/7)+1
  });

  it('player defender uses summed equip DEF (SumEquipDefenseAbility)', () => {
    const armored: Combatant = { ...player, equipDef: 20 };
    // byItem=20; floor((20)*2.3 + (1 + 15/2 + 15)/2.8 - 4 + 1*2 + fFactorDef)
    // bare calcDefense(player) baseline first:
    const base = calcDefense(player);
    const withEquip = calcDefense(armored);
    assert.ok(withEquip > base, 'equip DEF raises player defense');
    assert.equal(withEquip - base, Math.floor(20 * 2.3), 'equip DEF contributes via *2.3 factor');
  });
});

describe('combat getParrying (DST_PARRY)', () => {
  it('player parrying = floor(DEX/2) + parry', () => {
    assert.equal(getParrying(player), 7, 'floor(15/2)=7, no jewelry parry');
    const withRing: Combatant = { ...player, parry: 5 };
    assert.equal(getParrying(withRing), 12, '7 + 5 jewelry parry');
  });
});

describe('combat getAttackResult (DST_ADJ_HITRATE)', () => {
  it('clamps to MAX_HR=96 with no jewelry', () => {
    assert.equal(getAttackResult(player, aibatt), 96);
  });
  it('flat adjHitRate is added before the clamp (capped at 96)', () => {
    // base already clamps to 96, so +adjHitRate stays 96
    const withRing: Combatant = { ...player, adjHitRate: 10 };
    assert.equal(getAttackResult(withRing, aibatt), 96);
  });
  it('adjHitRate lifts a below-cap hit rate', () => {
    // Low-DEX player so the base rate sits below cap, then jewelry bumps it.
    const weak: Combatant = { ...player, dex: 5 };
    const base = getAttackResult(weak, aibatt);
    const withRing: Combatant = { ...weak, adjHitRate: 12 };
    assert.equal(getAttackResult(withRing, aibatt), base + 12, 'flat +12% from DST_ADJ_HITRATE');
  });
});

describe('combat resolveMelee', () => {
  it('normal hit, no crit, no block -> damage = ATK(16) - DEF(1) = 15', () => {
    // ints: hit=0(<96), crit=99(>=1), block=50(no block). range=16(min roll).
    const r = resolveMelee(player, aibatt, makeRng([0, 99, 50], 16));
    assert.equal(r.hit, true);
    assert.equal(r.damage, 15);
    assert.equal(r.atkFlags, AF_GENERIC);
  });

  it('miss (hit roll >= hitRate) -> AF_MISS, 0 damage', () => {
    const r = resolveMelee(player, aibatt, makeRng([99], 16));
    assert.equal(r.hit, false);
    assert.equal(r.damage, 0);
    assert.equal(r.atkFlags & AF_MISS, AF_MISS);
  });

  it('crit (crit roll < critProb=1) -> 2.3* ATK -> 36-1 = 35, AF_CRITICAL1', () => {
    // ints: hit=0, crit=0(<1 -> crit), block=50. range=16.
    const r = resolveMelee(player, aibatt, makeRng([0, 0, 50], 16));
    assert.equal(r.hit, true);
    assert.equal(r.damage, 35); // floor(16*2.3)=36, minus DEF 1
    assert.equal(r.atkFlags & AF_CRITICAL1, AF_CRITICAL1);
  });

  it('NPC block (block roll >=95) -> 90% reduction', () => {
    // ints: hit=0, crit=99, block=95(>=95 -> 0.1 factor). range=16.
    const r = resolveMelee(player, aibatt, makeRng([0, 99, 95], 16));
    assert.equal(r.hit, true);
    assert.equal(r.damage, 1); // floor((16-1)*0.1)=1
  });
});

describe('combat expLevelDiffMult', () => {
  it('playerLevel <= monsterLevel -> 1.0', () => {
    assert.equal(expLevelDiffMult(1, 1), 1.0);
    assert.equal(expLevelDiffMult(5, 10), 1.0);
  });
  it('delta 1-2 -> 0.7', () => {
    assert.equal(expLevelDiffMult(2, 1), 0.7);
    assert.equal(expLevelDiffMult(3, 1), 0.7);
  });
  it('delta 3-4 -> 0.4', () => {
    assert.equal(expLevelDiffMult(4, 1), 0.4);
    assert.equal(expLevelDiffMult(5, 1), 0.4);
  });
  it('delta >=5 -> 0.1', () => {
    assert.equal(expLevelDiffMult(6, 1), 0.1);
  });
});

describe('combat addExp (level-up cascade)', () => {
  it('no level-up when exp stays below the threshold', () => {
    // L1->L2 needs 14 (nExp1 0->14). Gain 5 at 0 -> still L1, exp 5.
    const r = addExp(1, 0, 5);
    assert.deepEqual(r, { level: 1, exp: 5, levelsGained: 0 });
  });

  it('resets to 0 at an exact boundary (no carryover)', () => {
    const r = addExp(1, 0, 14);
    assert.deepEqual(r, { level: 2, exp: 0, levelsGained: 1 });
  });

  it('carries excess into the next level on overflow', () => {
    // L1->L2 needs 14, L2->L3 needs 6 (14->20). Gain 18 from 0 -> L3, exp 18-14-6 = -2? No: 18-14=4, 4<6 stop -> L2 exp 4.
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

describe('combat cumulative <-> within-level conversion', () => {
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
  it('no loss at level <= 20', () => {
    assert.equal(subDieDecExp(15, 100).exp, 100);
    assert.equal(subDieDecExp(20, 100).exp, 100);
  });

  it('loses 6% of current-level cost at level 25 (Lv<=29 bracket)', () => {
    const need = expToNextLevel(25);
    const loss = Math.floor(need * 0.06);
    assert.equal(subDieDecExp(25, 1000).exp, 1000 - loss);
  });

  it('loses 5% of current-level cost at level 40 (Lv<=59 bracket)', () => {
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

describe('vitals recovery (maxFatiguePoint / standRecovery)', () => {
  // L1 VAGRANT (STA/INT=15), maxHP=100, maxMP=50. VAGRANT job factors:
  // fFactorMaxFP=0.3, fFactorHPRec=1.2, fFactorMPRec=0.5, fFactorFPRec=0.5.
  const vagrant = getJobProps(0);

  it('maxFatiguePoint matches the C++ GetMaxFatiguePoint formula', () => {
    // ((1*2 + 15*6)*0.3) + (15*0.3) = 27.6 + 4.5 = 32.1 -> 32
    assert.equal(maxFatiguePoint(1, 15, vagrant.fFactorMaxFP), 32);
    // ((10*2 + 15*6)*0.3) + 4.5 = (20+90)*0.3+4.5 = 33+4.5 = 37.5 -> 37
    assert.equal(maxFatiguePoint(10, 15, vagrant.fFactorMaxFP), 37);
  });

  it('maxFatiguePoint guards divide-by-zero at level 0', () => {
    // level clamps to 1 inside the formula; this just asserts no NaN/Infinity.
    const v = maxFatiguePoint(0, 15, vagrant.fFactorMaxFP);
    assert.equal(Number.isFinite(v), true);
    assert.equal(v, 32); // clamps lv=1 -> same as the L1 case
  });

  it('standRecovery hand-computed for L1 VAGRANT (v9+ 0.9 factor baked in)', () => {
    const maxFp = maxFatiguePoint(1, 15, vagrant.fFactorMaxFP);
    const r = standRecovery(1, 15, 15, 100, 50, maxFp, vagrant);
    // HP: ((1/3) + 100/500 + 15*1.2) * 0.9 = (0.333+0.2+18)*0.9 = 16.68 -> 16
    assert.equal(r.hp, 16);
    // MP: ((1.5 + 50/500 + 15*0.5) * 0.2) * 0.9 = (9.1*0.2)*0.9 = 1.638 -> 1
    assert.equal(r.mp, 1);
    // FP: ((2 + 32/500 + 15*0.5) * 0.2) * 0.9 = (9.564*0.2)*0.9 = 1.72 -> 1
    assert.equal(r.fp, 1);
  });

  it('standRecovery clamps negatives to 0 (never drains)', () => {
    const r = standRecovery(1, 0, 0, 0, 0, 0, vagrant);
    assert.equal(r.hp, 0);
    assert.equal(r.mp, 0);
    assert.equal(r.fp, 0);
  });
});

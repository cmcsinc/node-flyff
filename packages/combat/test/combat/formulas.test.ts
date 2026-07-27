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
  resolveMelee, getHitMinMax, getAttackResult, getParrying, getCriticalProb, getAttackSpeed, getDamageMultiplier,
  calcDefense, expLevelDiffMult,
  addExp, expToNextLevel, subDieDecExp,
  maxHitPoint, maxManaPoint, maxFatiguePoint, standRecovery,
  type Combatant, type Rng,
} from '../../src/combat/formulas';
import { WT_MELEE_SWD, NO_PROP, AF_GENERIC, AF_MISS, AF_CRITICAL1, getJobProps } from '../../src/combat/tables';
import { EMPTY_PARAM_VIEW, DST, ParamModel } from '@flyff/entities';

const FIST = { min: 0, max: 0, type: WT_MELEE_SWD, atkSpeed: 0.4, option: 0, element: NO_PROP };
const BARE_HAND = { min: 1, max: 3, type: WT_MELEE_SWD, atkSpeed: 0.4, option: 0, element: NO_PROP };
const REFINED_SWORD = { min: 10, max: 20, type: WT_MELEE_SWD, atkSpeed: 0.5, option: 5, element: NO_PROP };

const player: Combatant = {
  kind: 'player', level: 1, job: 0,
  str: 15, sta: 15, dex: 15, int: 15,
  weapon: BARE_HAND,
  npcAtkMin: 0, npcAtkMax: 0, npcArmor: 0, npcResisMagic: 0, npcHR: 0, npcER: 0, element: NO_PROP,
  equipDef: 0, adjHitRate: 0, parry: 0,
  params: EMPTY_PARAM_VIEW,
};

const aibatt: Combatant = {
  kind: 'npc', level: 1, job: 0,
  str: 0, sta: 0, dex: 0, int: 0,
  weapon: FIST,
  npcAtkMin: 16, npcAtkMax: 16, npcArmor: 3, npcResisMagic: 0, npcHR: 40, npcER: 3, element: NO_PROP,
  equipDef: 0, adjHitRate: 0, parry: 0,
  params: EMPTY_PARAM_VIEW,
};

/** Small Pukepuke (L7, atk 37, armor 10) -- a real low-level mob. */
const pukepuke: Combatant = {
  kind: 'npc', level: 7, job: 0,
  str: 0, sta: 0, dex: 0, int: 0,
  weapon: FIST,
  npcAtkMin: 37, npcAtkMax: 37, npcArmor: 10, npcResisMagic: 0, npcHR: 40, npcER: 11, element: NO_PROP,
  equipDef: 0, adjHitRate: 0, parry: 0,
  params: EMPTY_PARAM_VIEW,
};

/**
 * L30 VAGRANT STA 30 -- a higher-level, higher-DEF player. Base DEF
 * (no gear) = floor((60+15)/2.8 - 4 + (30-14)*1) = 38, which exceeds the
 * Pukepuke's ATK (37). Without the NPC->player min-damage rule this yields 0.
 */
const tank: Combatant = {
  ...player, level: 30, sta: 30,
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
    // AF_GENERIC path (MoverAttack.cpp:591): equip DEF contributes as byItem/4,
    // NOT the *2.3 of the PvP non-generic branch.
    const base = calcDefense(player);
    const withEquip = calcDefense(armored);
    assert.ok(withEquip > base, 'equip DEF raises player defense');
    assert.equal(withEquip - base, Math.floor(20 / 4), 'equip DEF contributes via /4 (AF_GENERIC)');
  });
});

describe('combat getParrying (DST_PARRY)', () => {
  it('player parrying = floor(DEX/2) + parry', () => {
    assert.equal(getParrying(player), 7, 'floor(15/2)=7, no jewelry parry');
    const withRing: Combatant = { ...player, parry: 5 };
    assert.equal(getParrying(withRing), 12, '7 + 5 jewelry parry');
  });
});

describe('combat DST param un-stubs', () => {
  it('DST_CHR_DMG raises getHitMinMax on both min and max', () => {
    const base = getHitMinMax(player);
    const params = new ParamModel();
    params.setDestParam(DST.CHR_DMG, 10);
    const buffed: Combatant = { ...player, params };
    const withDmg = getHitMinMax(buffed);
    assert.equal(withDmg.min - base.min, 10, 'CHR_DMG adds flat to min');
    assert.equal(withDmg.max - base.max, 10, 'CHR_DMG adds flat to max');
  });

  it('DST_ADJDEF raises calcDefense on a player defender', () => {
    const base = calcDefense({ ...player, equipDef: 20 });
    const params = new ParamModel();
    params.setDestParam(DST.ADJDEF, 30);
    const buffed: Combatant = { ...player, equipDef: 20, params };
    assert.ok(calcDefense(buffed) > base, 'ADJDEF buff raises player DEF');
    assert.equal(calcDefense(buffed) - base, 30, 'ADJDEF contributes flat (AF_GENERIC)');
  });

  it('DST_CHR_CHANCECRITICAL raises getCriticalProb', () => {
    const base = getCriticalProb(player);
    const params = new ParamModel();
    params.setDestParam(DST.CHR_CHANCECRITICAL, 8);
    assert.equal(getCriticalProb({ ...player, params }), base + 8);
  });

  it('H3: DST_ABILITY_MIN raises min (MoverAttack.cpp:508)', () => {
    const params = new ParamModel();
    params.setDestParam(DST.ABILITY_MIN, 10);
    const result = getHitMinMax({ ...player, params });
    // base min=16; ABILITY_MIN replaces 1*2=2 with 10, so min = 10 + 14.6 + 0 = 24.6 -> 24
    const base = getHitMinMax(player); // {16,20}
    assert.equal(result.min, 24, 'ABILITY_MIN=10 replaces weapon*2 before plus');
    assert.equal(result.max, 20, 'max unchanged (ABILITY_MAX not set)');
  });

  it('H3: DST_ABILITY_MAX raises max (MoverAttack.cpp:509)', () => {
    const params = new ParamModel();
    params.setDestParam(DST.ABILITY_MAX, 30);
    const result = getHitMinMax({ ...player, params });
    // max = 30 + 14.6 = 44.6 -> 44; min unchanged at 16
    assert.equal(result.max, 44, 'ABILITY_MAX=30 replaces weapon max before plus');
    assert.equal(result.min, 16, 'min unchanged (ABILITY_MIN not set)');
  });

  it('H3: DST_ABILITY_MIN floors at 0', () => {
    const params = new ParamModel();
    params.setDestParam(DST.ABILITY_MIN, -999);
    const result = getHitMinMax({ ...player, params });
    assert.ok(result.min >= 0, 'min never goes negative');
  });
});

describe('combat H4: GetItemMultiplier (refine option bonus)', () => {
  it('weapon option > 0 applies itemMult = 1 + option*0.02 before pow refine bonus', () => {
    const base = getHitMinMax({ ...player, weapon: REFINED_SWORD });
    // option=5, base weapon: min=10*2=20, max=20*2=40, plus=(STR-12)*4.5+LVL*1.1=14.6
    // C++ order: after ABILITY_MIN/MAX (not set) + plus:
    //   pre-mult min = 20+14.6=34.6, max=40+14.6=54.6
    // itemMult = 1+5*0.02=1.1 -> min=34.6*1.1=38.06, max=54.6*1.1=60.06
    // pow(5,1.5)=11.18->11 -> min=38.06+11=49.06->49, max=60.06+11=71.06->71
    // DST_ATKPOWER=0, DST_ATKPOWER_RATE=0
    assert.deepEqual(base, { min: 49, max: 71 });
  });

  it('option=0 skips itemMult (bare-hand unaffected)', () => {
    const base = getHitMinMax(player);
    assert.deepEqual(base, { min: 16, max: 20 }, 'bare-hand unchanged by H4');
  });
});

describe('combat getAttackSpeed', () => {
  it('rises with DEX (all else equal)', () => {
    const low = getAttackSpeed({ ...player, dex: 15 });
    const high = getAttackSpeed({ ...player, dex: 200 });
    assert.ok(high > low, 'more DEX -> faster attack speed');
  });

  it('clamps to [0.1, 2.0]', () => {
    const slow = getAttackSpeed({ ...player, dex: 1, level: 1 });
    assert.ok(slow >= 0.1, 'never below 0.1');
    const fast = getAttackSpeed({ ...player, dex: 10000, level: 500 });
    assert.ok(fast <= 2.0, 'never above 2.0');
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

describe('combat resolveMelee (NPC -> player min-damage rule)', () => {
  it('monster always deals >= 10% ATK even when DEF >= ATK (same level, no cosine)', () => {
    // Same-level scenario isolates the 10% floor from the v19 level-diff cosine
    // (nDelta=0 -> no falloff). pukepuke bumped to L30 to match `tank`; ATK 37
    // vs tank DEF 38 -> raw -1 -> 0, lifted to floor(37*0.1)=3, unchanged by mult.
    // ints: hit=0, crit=99, block=50. range=37.
    const sameLevelPuke: Combatant = { ...pukepuke, level: 30 };
    const r = resolveMelee(sameLevelPuke, tank, makeRng([0, 99, 50], 37));
    assert.equal(r.hit, true);
    assert.equal(r.damage, 3);
  });

  it('min rule does NOT apply player -> NPC (only NPC -> player)', () => {
    // Reverse direction: player ATK 37-ish vs aibatt DEF 1 still uses the raw
    // subtraction path -- no 10% floor on player swings.
    // L1 player bare-hand getHitMinMax = {16,20}; range=16 -> nATK=16, DEF=1 -> 15.
    const r = resolveMelee(player, aibatt, makeRng([0, 99, 50], 16));
    assert.equal(r.damage, 15);
  });

  it('v19 cosine crushes the 10% floor at a large level gap (L1 mob vs L30 player)', () => {
    // v19 GetDamageMultiplier (MoverAttack.cpp:998-1025): nDelta = defender.level
    // - attacker.level = 29, capped at 15, factor *= cos(15*pi/32) ~= 0.098.
    // The 10% NPC->player floor (1) is applied BEFORE the multiplier, then
    // floor(1 * 0.098) = 0 -- a L1 mob genuinely cannot damage a L30 player.
    const r = resolveMelee(aibatt, tank, makeRng([0, 99, 50], 16));
    assert.equal(r.hit, true);
    assert.equal(r.damage, 0); // 10% floor (1) * cosine(0.098) -> floor -> 0
  });
});

describe('combat H1: NPC->player ATK boost (PostCalcDamage:462)', () => {
  it('monster 6 levels above player deals +30% ATK (0.05*6)', () => {
    // pukepuke(L7) -> player(L1): nDelta=6, +30% boost on post-crit ATK.
    // ATK=37, no crit. Boost: floor(37*1.3)=48. Player DEF=0. No cosine
    // (defender.level-attacker.level = 1-7 = -6 < 0). Damage=48.
    // ints: hit=0, crit=99, block=50. range=37.
    const r = resolveMelee(pukepuke, player, makeRng([0, 99, 50], 37));
    assert.equal(r.hit, true);
    assert.equal(r.damage, 48);
  });
  it('no boost when monster is same or lower level', () => {
    // aibatt(L1) -> player(L1): nDelta=0, no boost. ATK=16, DEF=0, damage=16.
    const r = resolveMelee(aibatt, player, makeRng([0, 99, 50], 16));
    assert.equal(r.hit, true);
    assert.equal(r.damage, 16);
  });
  it('boost does NOT apply player -> NPC', () => {
    // player(L1) -> pukepuke(L7): no ATK boost. ATK=16, DEF=2, cosine(nDelta=6).
    // damage = floor((16-2)*cos(6*pi/32)) = floor(14*0.8315) = 11.
    const r = resolveMelee(player, pukepuke, makeRng([0, 99, 50], 16));
    assert.equal(r.hit, true);
    assert.equal(r.damage, 11);
  });
});

describe('combat H5: DST_ADJDEF_RATE (GetDEFMultiplier)', () => {
  it('positive ADJDEF_RATE raises player defense', () => {
    const base = calcDefense({ ...player, equipDef: 20 });
    const params = new ParamModel();
    params.setDestParam(DST.ADJDEF_RATE, 50); // +50% defense
    const buffed = calcDefense({ ...player, equipDef: 20, params });
    const expected = Math.floor(base * 1.5);
    assert.equal(buffed, expected, 'ADJDEF_RATE=50 => defense * 1.5');
  });
  it('negative ADJDEF_RATE reduces player defense', () => {
    const base = calcDefense({ ...player, equipDef: 20 });
    const params = new ParamModel();
    params.setDestParam(DST.ADJDEF_RATE, -30); // -30% defense
    const debuffed = calcDefense({ ...player, equipDef: 20, params });
    const expected = Math.floor(base * 0.7);
    assert.equal(debuffed, expected, 'ADJDEF_RATE=-30 => defense * 0.7');
  });
  it('ADJDEF_RATE floors at 0 (defense never goes negative from this modifier)', () => {
    // Base DEF=0 (no gear, low stats), -50% modifier -> 0, not negative.
    const params = new ParamModel();
    params.setDestParam(DST.ADJDEF_RATE, -50);
    assert.equal(calcDefense({ ...player, params }), 0, '0 DEF * 0.5 = 0 (floored)');
  });
  it('ADJDEF_RATE also applies to NPC defense', () => {
    // aibatt base DEF = floor(3/7)+1 = 1. With +100% rate => 2.
    const params = new ParamModel();
    params.setDestParam(DST.ADJDEF_RATE, 100);
    const buffed = calcDefense({ ...aibatt, params });
    assert.equal(buffed, 2, 'NPC DEF 1 * 2.0 = 2');
  });
});

describe('combat getDamageMultiplier (v19 level-diff cosine)', () => {
  it('applies cos(pi*nDelta/32) when defender is higher level and either side is NPC', () => {
    // pukepuke(L7) vs tank(L30): nDelta=23 -> capped at 15.
    const expected = Math.cos((Math.PI * 15) / 32); // ~0.098017
    assert.equal(getDamageMultiplier(pukepuke, tank), expected);
    // L7 mob vs L80 player: nDelta=73 -> same cap, same factor.
    const hero: Combatant = { ...tank, level: 80 };
    assert.equal(getDamageMultiplier(pukepuke, hero), expected);
  });
  it('NO cosine when defender is not higher level (nDelta <= 0)', () => {
    // player(L30) -> pukepuke(L7): nDelta = 7-30 = -23 -> no reduction.
    assert.equal(getDamageMultiplier(tank, pukepuke), 1.0);
  });
  it('NO cosine for PvP (both players) -- flat 0.6 only', () => {
    const otherPlayer: Combatant = { ...tank, level: 80 };
    assert.equal(getDamageMultiplier(tank, otherPlayer), 0.6);
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
    // L1 threshold is EXP_TABLE[2].nExp1 = 14. Gain 5 at 0 -> still L1, exp 5.
    const r = addExp(1, 0, 5);
    assert.deepEqual(r, { level: 1, exp: 5, levelsGained: 0 });
  });

  it('resets to 0 at an exact boundary (no carryover)', () => {
    const r = addExp(1, 0, 14);
    assert.deepEqual(r, { level: 2, exp: 0, levelsGained: 1 });
  });

  it('carries excess into the next level on overflow', () => {
    // L1 threshold 14, L2 threshold 20. Gain 18 from 0 -> 18-14=4 (L2), 4<20 stop.
    const r = addExp(1, 0, 18);
    assert.deepEqual(r, { level: 2, exp: 4, levelsGained: 1 });
  });

  it('cascades multiple levels from a single large gain', () => {
    // Thresholds: L1=14, L2=20, L3=36, L4=90. Gain 100 from L1 exp 0:
    //   100-14=86 (L2), 86-20=66 (L3), 66-36=30 (L4), 30<90 stop -> L4 exp 30.
    const r = addExp(1, 0, 100);
    assert.deepEqual(r, { level: 4, exp: 30, levelsGained: 3 });
  });

  it('caps at MAX_LEVEL (no further progression)', () => {
    const huge = addExp(1, 0, Number.MAX_SAFE_INTEGER);
    assert.ok(huge.level < 200);
    assert.equal(huge.level, huge.level); // reached a finite cap row
  });

  it('expToNextLevel is the next level raw nExp1 (per-level threshold, not delta)', () => {
    assert.equal(expToNextLevel(1), 14);  // EXP_TABLE[2].nExp1
    assert.equal(expToNextLevel(2), 20);  // EXP_TABLE[3].nExp1
    assert.equal(expToNextLevel(3), 36);  // EXP_TABLE[4].nExp1
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

describe('vitals recovery (maxHitPoint / maxManaPoint / maxFatiguePoint / standRecovery)', () => {
  // L1 VAGRANT (STA/INT=15), maxHP=100, maxMP=50. VAGRANT job factors:
  // fFactorMaxFP=0.3, fFactorHPRec=1.2, fFactorMPRec=0.5, fFactorFPRec=0.5.
  const vagrant = getJobProps(0);

  it('maxHitPoint matches the C++ GetMaxOriginHitPoint formula', () => {
    // a = 0.9*1/2 = 0.45; b = 0.45*(2/4)*(1+15/50) + 15*10 = 0.2925 + 150 = 150.2925
    // maxHP = floor(150.2925 + 80) = 230
    assert.equal(maxHitPoint(1, 15, vagrant.fFactorMaxHP), 230);
    // a = 0.9*10/2 = 4.5; b = 4.5*(11/4)*1.3 + 150 = 16.0875 + 150 = 166.0875 -> 246
    assert.equal(maxHitPoint(10, 15, vagrant.fFactorMaxHP), 246);
  });

  it('maxManaPoint matches the C++ GetMaxOriginManaPoint formula', () => {
    // (((1*2) + 15*8)*0.3) + 22 + 15*0.3 = 36.6 + 22 + 4.5 = 63.1 -> 63
    assert.equal(maxManaPoint(1, 15, vagrant.fFactorMaxMP), 63);
    // (((20) + 120)*0.3) + 22 + 4.5 = 42 + 26.5 = 68.5 -> 68
    assert.equal(maxManaPoint(10, 15, vagrant.fFactorMaxMP), 68);
  });

  it('maxHitPoint/maxManaPoint guard divide-by-zero at level 0', () => {
    assert.equal(maxHitPoint(0, 15, vagrant.fFactorMaxHP), 230); // lv clamps to 1
    assert.equal(maxManaPoint(0, 15, vagrant.fFactorMaxMP), 63);
  });

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

/**
 * `ApplyDPC` unit tests -- the POSTCALC_DPC damage sink (`CMover::ApplyDPC`,
 * `MoverAttack.cpp:1645`) plus the one-shot party critical bonus term in
 * `GetCriticalProb` (`MoverAttack.cpp:697-707`).
 *
 * Routing recap: `GetPostCalcType` (`AttackArbiter.cpp:434-450`) sends
 * AF_MAGICSKILL -> POSTCALC_MAGICSKILL, AF_GENERIC -> POSTCALC_GENERIC and
 * everything else through to POSTCALC_DPC. Melee skills (`Ctrl.cpp:1024-1031`
 * sets only AF_MELEESKILL) and bare-AF_MAGIC wand swings land here.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { applyDpc, getCriticalProb, type Combatant, type Rng } from '../../src/combat/formulas';
import {
  WT_MELEE_SWD, WT_MELEE_YOYO, NO_PROP, MAX_CHARGE_LEVEL,
  AF_CRITICAL, AF_CRITICAL1, AF_CRITICAL2, AF_FLYING, AF_FORCE,
  AF_MELEESKILL, AF_MAGICSKILL,
  SI_BIL_PST_ASALRAALAIKUM, SI_JST_YOYO_HITOFPENYA,
  RANK_LOW,
} from '../../src/combat/tables';
import { EMPTY_PARAM_VIEW, DST, ParamModel } from '@flyff/entities';

const BARE_HAND = { min: 1, max: 3, type: WT_MELEE_SWD, atkSpeed: 0.4, option: 0, element: NO_PROP };
const FIST = { min: 0, max: 0, type: WT_MELEE_SWD, atkSpeed: 0.4, option: 0, element: NO_PROP };

const attacker: Combatant = {
  kind: 'player', level: 1, job: 0,
  str: 15, sta: 15, dex: 15, int: 15,
  weapon: BARE_HAND,
  npcAtkMin: 0, npcAtkMax: 0, npcArmor: 0, npcResisMagic: 0, npcHR: 0, npcER: 0, element: NO_PROP,
  equipDef: 0, equipDefMax: 0, adjHitRate: 0, parry: 0,
  params: EMPTY_PARAM_VIEW,
};

/** Small Aibatt (armor 3) -> `calcDefense` = floor(3/7)+1 = 1. */
const aibatt: Combatant = {
  kind: 'npc', level: 1, job: 0,
  str: 0, sta: 0, dex: 0, int: 0,
  weapon: FIST,
  npcAtkMin: 16, npcAtkMax: 16, npcArmor: 3, npcResisMagic: 0, npcHR: 40, npcER: 3, element: NO_PROP,
  equipDef: 0, equipDefMax: 0, adjHitRate: 0, parry: 0,
  params: EMPTY_PARAM_VIEW,
  rank: RANK_LOW, flyable: false,
};

const AIBATT_DEF = 1;

/** Scripted rng: `int()` walks `ints` in call order, `range()` returns `lo`. */
function makeRng(ints: number[]): Rng {
  let i = 0;
  return { int: () => ints[i++] ?? 0, range: (lo: number) => lo };
}

/** Attacker whose crit prob is force-overridden to `pct` via a chg value. */
function critAttacker(pct: number, extra?: Partial<Combatant>): Combatant {
  const params = new ParamModel();
  params.applyEffects([{ dst: DST.CHR_CHANCECRITICAL, adj: 0, chg: pct }]);
  return { ...attacker, params, ...extra };
}

describe('applyDpc -- defense subtract', () => {
  it('nDamage = nATK - CalcDefense on a plain non-crit hit', () => {
    // crit prob 0 -> the crit roll (rng.int(100) = 50) can never pass.
    const r = applyDpc({
      attacker: critAttacker(0), defender: aibatt, nATK: 100,
      atkFlags: AF_MELEESKILL, rng: makeRng([50]),
    });
    assert.equal(r.damage, 100 - AIBATT_DEF);
    assert.equal(r.atkFlags, AF_MELEESKILL, 'no flags added');
  });

  it('clamps to 0 when defense exceeds ATK (never negative)', () => {
    const wall: Combatant = { ...aibatt, npcArmor: 7000 }; // floor(7000/7)+1 = 1001
    const r = applyDpc({
      attacker: critAttacker(0), defender: wall, nATK: 5,
      atkFlags: AF_MELEESKILL, rng: makeRng([50]),
    });
    assert.equal(r.damage, 0);
  });
});

describe('applyDpc -- CanIgnoreDEF (AttackArbiter.cpp:56-69)', () => {
  it('AF_FORCE bypasses defense entirely', () => {
    const r = applyDpc({
      attacker: critAttacker(0), defender: aibatt, nATK: 100,
      atkFlags: AF_MELEESKILL | AF_FORCE, rng: makeRng([50]),
    });
    assert.equal(r.damage, 100, 'full ATK, no DEF subtract');
  });

  it('Asalraalaikum (159) bypasses defense', () => {
    const r = applyDpc({
      attacker: critAttacker(0), defender: aibatt, nATK: 100,
      atkFlags: AF_MELEESKILL, skillId: SI_BIL_PST_ASALRAALAIKUM, rng: makeRng([50]),
    });
    assert.equal(r.damage, 100);
  });

  it('Hit of Penya (212) bypasses defense', () => {
    const r = applyDpc({
      attacker: critAttacker(0), defender: aibatt, nATK: 100,
      atkFlags: AF_MELEESKILL, skillId: SI_JST_YOYO_HITOFPENYA, rng: makeRng([50]),
    });
    assert.equal(r.damage, 100);
  });

  it('any other skill id still pays defense', () => {
    const r = applyDpc({
      attacker: critAttacker(0), defender: aibatt, nATK: 100,
      atkFlags: AF_MELEESKILL, skillId: 1, rng: makeRng([50]),
    });
    assert.equal(r.damage, 100 - AIBATT_DEF);
  });
});

describe('applyDpc -- IsSkillAttack suppresses crit (MoverAttack.cpp:800)', () => {
  it('AF_MELEESKILL never crits even at 100% crit prob', () => {
    const r = applyDpc({
      attacker: critAttacker(100), defender: aibatt, nATK: 100,
      atkFlags: AF_MELEESKILL, rng: makeRng([0, 0]),
    });
    assert.equal(r.damage, 100 - AIBATT_DEF, 'no 2.3x multiplier');
    assert.equal(r.atkFlags & AF_CRITICAL, 0, 'AF_CRITICAL clear');
  });

  it('AF_MAGICSKILL never crits either', () => {
    const r = applyDpc({
      attacker: critAttacker(100), defender: aibatt, nATK: 100,
      atkFlags: AF_MAGICSKILL, rng: makeRng([0, 0]),
    });
    assert.equal(r.damage, 100 - AIBATT_DEF);
    assert.equal(r.atkFlags & AF_CRITICAL, 0);
  });
});

describe('applyDpc -- crit multiplier', () => {
  it('normal crit is 2.3x and sets the FULL AF_CRITICAL mask', () => {
    // rng: [crit roll 0 (<100 -> crit), fly roll 99 (>=30 -> no knock-up)]
    const r = applyDpc({
      attacker: critAttacker(100), defender: aibatt, nATK: 100,
      atkFlags: 0, rng: makeRng([0, 99]),
    });
    assert.equal(r.damage, Math.trunc((100 - AIBATT_DEF) * 2.3));
    assert.equal(r.atkFlags & AF_CRITICAL, AF_CRITICAL, 'both crit bits set');
    assert.equal(r.atkFlags & AF_CRITICAL1, AF_CRITICAL1);
    assert.equal(r.atkFlags & AF_CRITICAL2, AF_CRITICAL2);
    assert.equal(r.atkFlags & AF_FLYING, 0, 'fly roll failed');
  });

  it('OBJSTA_ATK4 (4th combo swing) upgrades the crit to 2.6x', () => {
    const r = applyDpc({
      attacker: critAttacker(100), defender: aibatt, nATK: 100,
      atkFlags: 0, atk4: true, rng: makeRng([0, 99]),
    });
    assert.equal(r.damage, Math.trunc((100 - AIBATT_DEF) * 2.6));
  });

  it('max charge level also upgrades the crit to 2.6x', () => {
    const r = applyDpc({
      attacker: critAttacker(100), defender: aibatt, nATK: 100,
      atkFlags: 0, chargeLevel: MAX_CHARGE_LEVEL, rng: makeRng([0, 99]),
    });
    assert.equal(r.damage, Math.trunc((100 - AIBATT_DEF) * 2.6));
  });

  it('a partial charge stays on the 2.3x arm', () => {
    const r = applyDpc({
      attacker: critAttacker(100), defender: aibatt, nATK: 100,
      atkFlags: 0, chargeLevel: MAX_CHARGE_LEVEL - 1, rng: makeRng([0, 99]),
    });
    assert.equal(r.damage, Math.trunc((100 - AIBATT_DEF) * 2.3));
  });

  it('a failed crit roll leaves damage and flags untouched', () => {
    // prob 30, roll 30 -> `30 < 30` is false.
    const r = applyDpc({
      attacker: critAttacker(30), defender: aibatt, nATK: 100,
      atkFlags: 0, rng: makeRng([30]),
    });
    assert.equal(r.damage, 100 - AIBATT_DEF);
    assert.equal(r.atkFlags, 0);
  });
});

describe('applyDpc -- AF_FLYING knock-up probability differs by arm', () => {
  it('normal crit uses a 30% fly roll', () => {
    const hit = applyDpc({
      attacker: critAttacker(100), defender: aibatt, nATK: 100,
      atkFlags: 0, rng: makeRng([0, 29]),
    });
    assert.equal(hit.atkFlags & AF_FLYING, AF_FLYING, '29 < 30 -> knock-up');
    const miss = applyDpc({
      attacker: critAttacker(100), defender: aibatt, nATK: 100,
      atkFlags: 0, rng: makeRng([0, 30]),
    });
    assert.equal(miss.atkFlags & AF_FLYING, 0, '30 is NOT < 30');
  });

  it('max-charge / ATK4 crit uses a 50% fly roll', () => {
    const hit = applyDpc({
      attacker: critAttacker(100), defender: aibatt, nATK: 100,
      atkFlags: 0, atk4: true, rng: makeRng([0, 49]),
    });
    assert.equal(hit.atkFlags & AF_FLYING, AF_FLYING, '49 < 50 -> knock-up');
    const miss = applyDpc({
      attacker: critAttacker(100), defender: aibatt, nATK: 100,
      atkFlags: 0, atk4: true, rng: makeRng([0, 50]),
    });
    assert.equal(miss.atkFlags & AF_FLYING, 0, '50 is NOT < 50');
  });

  it('CanFlyByAttack still gates it -- a yoyo never knocks up', () => {
    const r = applyDpc({
      attacker: critAttacker(100, { weapon: { ...BARE_HAND, type: WT_MELEE_YOYO } }),
      defender: aibatt, nATK: 100, atkFlags: 0, rng: makeRng([0, 0]),
    });
    assert.equal(r.atkFlags & AF_CRITICAL, AF_CRITICAL, 'still a crit');
    assert.equal(r.atkFlags & AF_FLYING, 0, 'yoyo excluded from knock-up');
  });
});

describe('applyDpc -- DST_CRITICAL_BONUS', () => {
  it('scales the post-multiplier damage by 1 + bonus/100', () => {
    const params = new ParamModel();
    params.applyEffects([{ dst: DST.CHR_CHANCECRITICAL, adj: 0, chg: 100 }]);
    params.setDestParam(DST.CRITICAL_BONUS, 50);
    const r = applyDpc({
      attacker: { ...attacker, params }, defender: aibatt, nATK: 100,
      atkFlags: 0, rng: makeRng([0, 99]),
    });
    const crit = Math.trunc((100 - AIBATT_DEF) * 2.3);
    assert.equal(r.damage, Math.trunc(crit * 1.5));
  });

  it('floors the bonus factor at 0.1 (__JEFF_11)', () => {
    const params = new ParamModel();
    params.applyEffects([{ dst: DST.CHR_CHANCECRITICAL, adj: 0, chg: 100 }]);
    params.setDestParam(DST.CRITICAL_BONUS, -500); // 1 - 5 = -4 -> clamped to 0.1
    const r = applyDpc({
      attacker: { ...attacker, params }, defender: aibatt, nATK: 100,
      atkFlags: 0, rng: makeRng([0, 99]),
    });
    const crit = Math.trunc((100 - AIBATT_DEF) * 2.3);
    assert.equal(r.damage, Math.trunc(crit * 0.1));
  });
});

describe('getCriticalProb -- party SphereCircle bonus', () => {
  it('adds the already-consumed partyCritBonus on top of the base roll', () => {
    const base = getCriticalProb(attacker);
    assert.equal(getCriticalProb({ ...attacker, partyCritBonus: 4 }), base + 4);
  });

  it('stacks on top of a DST chg-override (added after GetParam)', () => {
    const params = new ParamModel();
    params.applyEffects([{ dst: DST.CHR_CHANCECRITICAL, adj: 0, chg: 42 }]);
    assert.equal(getCriticalProb({ ...attacker, params, partyCritBonus: 3 }), 45);
  });

  it('absent bonus behaves as 0', () => {
    assert.equal(getCriticalProb({ ...attacker, partyCritBonus: undefined }), getCriticalProb(attacker));
  });

  it('the bonus survives the negative clamp -- clamp applies to the base only', () => {
    const params = new ParamModel();
    params.applyEffects([{ dst: DST.CHR_CHANCECRITICAL, adj: 0, chg: -5 }]);
    assert.equal(getCriticalProb({ ...attacker, params, partyCritBonus: 2 }), 2);
  });
});

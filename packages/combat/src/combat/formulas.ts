/**
 * v19 combat math -- pure port of the `CAttackArbiter` damage pipeline.
 *
 * Source: `docs/combat-research.md` #A/#B (canonical). All C++ function names
 * preserved as comments. Pure functions over {@link Combatant} views so the
 * math is unit-testable with hand-computed expected outputs.
 *
 * Exp / vitals / Rng math moved to `@flyff/entities` (shared with CPlayer +
 * recovery); re-exported here for legacy `from './formulas'` importers.
 *
 * @module combat/formulas
 */

import {
  ATK_SPEED_PLUS, elementFactor,
  AF_MISS, AF_CRITICAL1, AF_BLOCKING, AF_GENERIC,
  WT_MELEE_SWD, WT_MELEE_AXE, WT_MELEE_STICK, WT_MELEE_KNUCKLE,
  WT_MELEE_STAFF, WT_MAGIC_WAND, WT_MELEE_YOYO, WT_RANGE_BOW,
  MIN_HR, MAX_HR,
} from './tables';
import { getJobProps } from '@flyff/entities';
import type { JobProps, Rng, ParamView } from '@flyff/entities';
import { DST, EMPTY_PARAM_VIEW } from '@flyff/entities';

// exp / vitals / rng moved to @flyff/entities -- re-export for transition.
export {
  expLevelDiffMult, expToNextLevel, addExp, subDieDecExp,
} from '@flyff/entities';
export type { ExpGainResult } from '@flyff/entities';
export { maxHitPoint, maxManaPoint, maxFatiguePoint, standRecovery } from '@flyff/entities';
export type { RecoveryAmount } from '@flyff/entities';
export type { Rng } from '@flyff/entities';
export { xRandomRng } from '@flyff/entities';

/** Equipped-weapon view. `CombatService` supplies this; unarmed = bare-hand. */
export interface WeaponStats {
  /** propItem `dwAbilityMin` (raw). */
  readonly min: number;
  /** propItem `dwAbilityMax` (raw). */
  readonly max: number;
  /** `WT_*` weapon type (drives STR scaling). */
  readonly type: number;
  /** propItem `fAttackSpeed` (0-1 scale; bare-hand ~= 0.4). */
  readonly atkSpeed: number;
  /** `abilityOption` (upgrade level; 0 = no bonus). */
  readonly option: number;
  /** Weapon element (`NO_PROP` if none). */
  readonly element: number;
}

/** Attacker/defender stat view built from `CPlayer` / `CMover` by the service. */
export interface Combatant {
  readonly kind: 'player' | 'npc';
  readonly level: number;
  /** Player job id (`defineJob.h`); NPC = 0 (VAGRANT via `getJobProps`). */
  readonly job: number;
  readonly str: number;
  readonly sta: number;
  readonly dex: number;
  readonly int: number;
  /** Equipped weapon (player). NPC = bare-hand stub. */
  readonly weapon: WeaponStats;
  /** NPC raw propMover stats (`dwAtkMin/Max`). Player = 0. */
  readonly npcAtkMin: number;
  readonly npcAtkMax: number;
  /** NPC `dwNaturalArmor` / `dwResisMgic`. Player = 0. */
  readonly npcArmor: number;
  readonly npcResisMagic: number;
  /** NPC `dwHR` / `dwER`. Player = 0. */
  readonly npcHR: number;
  readonly npcER: number;
  /** Mover element (`eElementType`). */
  readonly element: number;
  /** Summed equip DEF floor (player armor dwAbilityMin; NPC = 0). */
  readonly equipDef: number;
  /** Summed equip DEF ceiling (player armor dwAbilityMax; NPC = 0).
   *  When > equipDef, `calcDefense` randomizes between the two per hit. */
  readonly equipDefMax: number;
  /** Flat hit-rate % from DST_ADJ_HITRATE (player jewelry/buffs; NPC = 0). */
  readonly adjHitRate: number;
  /** Evasion from DST_PARRY (player jewelry/buffs; NPC = 0). */
  readonly parry: number;
  /**
   * DST parameter view (player `m_params`; NPC = `EMPTY_PARAM_VIEW`). Read by
   * un-stubbed terms: `DST_CHR_DMG`/`DST_ATKPOWER` (ATK), `DST_ADJDEF` (DEF),
   * `DST_CHR_CHANCECRITICAL` (crit), etc. C++ `GetParam(dst, def)`.
   */
  readonly params: ParamView;
}

export interface MeleeResult {
  readonly hit: boolean;
  readonly damage: number;
  readonly atkFlags: number;
}

// --- stat getters (#A) -------------------------------------------------------

/** `GetWeaponATK` (MoverAttack.cpp:371) -- STR/level scaling per weapon type. */
export function getWeaponATK(c: Combatant): number {
  const job = getJobProps(c.job);
  const LVL = c.level, STR = c.str, INT = c.int;
  switch (c.weapon.type) {
    case WT_MELEE_SWD:     return (STR - 12) * job.fMeleeSWD + LVL * 1.1;
    case WT_MELEE_AXE:     return (STR - 12) * job.fMeleeAXE + LVL * 1.2;
    case WT_MELEE_STICK:   return (STR - 10) * job.fMeleeSTICK + LVL * 1.3;
    case WT_MELEE_KNUCKLE: return (STR - 10) * job.fMeleeKNUCKLE + LVL * 1.2;
    case WT_MELEE_STAFF:   return (STR - 10) * job.fMeleeSTAFF + LVL * 1.1;
    case WT_MAGIC_WAND:    return (INT - 10) * job.fMagicWAND + LVL * 1.2;
    case WT_MELEE_YOYO:    return (STR - 12) * job.fMeleeYOYO + LVL * 1.1;
    case WT_RANGE_BOW:     return ((c.dex - 14) * 4.0 + LVL * 1.3 + STR * 0.2) * 0.7;
    default:               return (STR - 12) * job.fMeleeSWD + LVL * 1.1; // bare-hand -> sword curve
  }
}

/** `GetHitMinMax` (MoverAttack.cpp:412) -- final pre-roll min/max. */
export function getHitMinMax(c: Combatant): { min: number; max: number } {
  if (c.kind === 'npc') {
    return { min: c.npcAtkMin, max: c.npcAtkMax || c.npcAtkMin };
  }
  let nMin = c.weapon.min * 2;
  let nMax = c.weapon.max * 2;
  // H3: DST_ABILITY_MIN/MAX (MoverAttack.cpp:508-509) -- flat buff/equip modifiers
  // applied to the raw weapon ability range, before weapon ATK and item multiplier.
  nMin = c.params.get(DST.ABILITY_MIN, nMin);
  nMax = c.params.get(DST.ABILITY_MAX, nMax);
  if (nMin < 0) nMin = 0;
  if (nMax < 0) nMax = 0;
  // GetWeaponATK + GetParam(DST_CHR_DMG) + GetPlusWeaponATK(refine) -- C++ adds
  // the CHR_DMG buff to both min/max; refine bonus is the pow(option,1.5) below.
  const plus = getWeaponATK(c) + c.params.get(DST.CHR_DMG, 0);
  nMin += plus;
  nMax += plus;
  // H4: GetItemMultiplier (MoverAttack.cpp:2135) -- scales by refine option bonus.
  // ponytail: full C++ also checks expired flag (0) and durability; add when
  //   expiry model and durability are implemented.
  if (c.weapon.option > 0) {
    const itemMult = 1.0 + c.weapon.option * 0.02;
    nMin *= itemMult;
    nMax *= itemMult;
    const v = Math.floor(Math.pow(c.weapon.option, 1.5));
    nMin += v;
    nMax += v;
  }
  // DST_ATKPOWER (flat) + DST_ATKPOWER_RATE (%) -- C++ GetHitMinMax tail.
  const atkPower = c.params.get(DST.ATKPOWER, 0);
  if (atkPower !== 0) { nMin += atkPower; nMax += atkPower; }
  const atkRate = c.params.get(DST.ATKPOWER_RATE, 0);
  if (atkRate !== 0) { nMin *= 1 + atkRate / 100; nMax *= 1 + atkRate / 100; }
  return { min: Math.floor(nMin), max: Math.floor(nMax) };
}

/** `GetHR` (MoverAttack.cpp:233) -- DEX (player) / `dwHR` (NPC). */
export function getHR(c: Combatant): number {
  return c.kind === 'player' ? c.dex : c.npcHR;
}

/** `GetParrying` (MoverParam.cpp:506) -- DEX/2 + DST_PARRY (player) / `dwER` (NPC). */
export function getParrying(c: Combatant): number {
  return c.kind === 'player' ? Math.floor(c.dex * 0.5) + c.parry : c.npcER;
}

/** `GetCriticalProb` (MoverAttack.cpp:609) -- `(DEX/10) * job.fCritical` + DST_CHR_CHANCECRITICAL. */
export function getCriticalProb(c: Combatant): number {
  return Math.floor((c.dex / 10) * getJobProps(c.job).fCritical) + c.params.get(DST.CHR_CHANCECRITICAL, 0);
}

/**
 * `GetAttackSpeed` (`MoverAttack.cpp:156`) -- animation-speed multiplier in
 * `[0.1, 2.0]`. Drives CLIENT-side swing animation (`m_fAniSpeed`); the server
 * does NOT gate cadence by this -- it's ported for correctness, future
 * `DST_ATTACKSPEED` buff support, and anti-cheat echo validation.
 *
 * `A = int( job.fAttackSpeed + weapon.atkSpeed*(4*DEX + LVL/8) - 3 )`, capped at
 * 187; `fSpeed = (50/(200-A))/2 + ATK_SPEED_PLUS[A/10]`; then flat
 * `DST_ATTACKSPEED` (/1000) + `% DST_ATTACKSPEED_RATE`.
 */
export function getAttackSpeed(c: Combatant): number {
  const job = getJobProps(c.job);
  const fItem = c.weapon.atkSpeed;
  let A = Math.floor(job.fAttackSpeed + (fItem * (4.0 * c.dex + c.level / 8.0)) - 3.0);
  if (A >= 188) A = 187; // C++ `if (187.5 <= A) A = (int)(187.5)` with A already int
  const idx = Math.max(0, Math.min(17, Math.floor(A / 10)));
  let fSpeed = (50.0 / (200 - A)) / 2.0 + (ATK_SPEED_PLUS[idx] ?? 0);
  fSpeed += c.params.get(DST.ATTACKSPEED, 0) / 1000.0;
  const rate = c.params.get(DST.ATTACKSPEED_RATE, 0);
  if (rate > 0) fSpeed += (fSpeed * rate) / 100.0;
  return Math.max(0.1, Math.min(2.0, fSpeed));
}

// --- damage pipeline (#B) ----------------------------------------------------

/**
 * `GetAttackResult` (MoverAttack.cpp:241) -- server-authoritative hit roll.
 * Player->NPC branch. Clamp `[MIN_HR, MAX_HR]`; `hit = xRandom(100) < nHitRate`.
 */
export function getAttackResult(attacker: Combatant, defender: Combatant): number {
  const HR = getHR(attacker);
  const parry = getParrying(defender);
  const LVL = attacker.level, defLVL = defender.level;
  let rate: number;
  if (attacker.kind === 'player' && defender.kind === 'npc') {
    // MoverAttack.cpp:333-336 — Player→NPC hit rate
    rate = (HR * 1.6 / (HR + parry)) * 1.5 * (LVL * 1.2 / (LVL + defLVL)) * 100;
  } else if (attacker.kind === 'npc' && defender.kind === 'player') {
    rate = (HR * 1.6 / (HR + parry)) * 1.5 * (LVL * 1.2 / (LVL + defLVL)) * 100;
  } else { // PvP
    rate = (HR * 1.6 / (HR + parry)) * 1.2 * (LVL * 1.2 / (LVL + defLVL)) * 100;
  }
  rate += attacker.adjHitRate; // nHitRate += GetAdjHitRate() (MoverAttack.cpp:273)
  return clamp(Math.floor(rate), MIN_HR, MAX_HR);
}

/**
 * `CalcDefenseCore` (MoverAttack.cpp:573) -- NPC melee: `dwNaturalArmor/7 + 1`.
 * When `rng` is supplied and the defender has a defense range (`equipDefMax` >
 * `equipDef`), the equip defense is randomized per hit (C++ `GetDefenseByItem
 * (bRandom=TRUE)`). Without `rng` or with no range, uses deterministic floor.
 */
export function calcDefense(defender: Combatant, rng?: Rng): number {
  if (defender.kind === 'npc') {
    let nDefense = Math.floor(defender.npcArmor / 7.0) + 1;
    // GetDEFMultiplier applies to NPCs too (MoverAttack.cpp:592)
    const adjDefRate = defender.params.get(DST.ADJDEF_RATE, 0);
    if (adjDefRate !== 0) {
      nDefense = Math.floor(nDefense * (1.0 + adjDefRate / 100));
    }
    return Math.max(0, nDefense);
  }
  // Player defender, AF_GENERIC path (`CalcDefenseCore`, MoverAttack.cpp:591):
  //   nDef = ((L*2 + S/2)/2.8 - 4) + (S-14)*fFactorDef + GetDefenseByItem(bRandom)/4 + DST_ADJDEF
  const job = getJobProps(defender.job);
  // GetDefenseByItem: xRandom(defenseMin, defenseMax) when range exists.
  let byItem: number;
  if (rng && defender.equipDefMax > defender.equipDef) {
    byItem = rng.range(defender.equipDef, defender.equipDefMax + 1);
  } else {
    byItem = defender.equipDef;
  }
  const adjDef = defender.params.get(DST.ADJDEF, 0); // GetParam(DST_ADJDEF) buff
  const statTerm = (defender.level * 2 + Math.floor(defender.sta / 2)) / 2.8 - 4;
  const factorTerm = (defender.sta - 14) * job.fFactorDef;
  let nDefense = Math.floor(statTerm + factorTerm) + Math.floor(byItem / 4) + adjDef;
  // GetDEFMultiplier (MoverAttack.cpp:592): DST_ADJDEF_RATE is a % modifier
  // applied after base defense. Positive = more defense, negative = less.
  const adjDefRate = defender.params.get(DST.ADJDEF_RATE, 0);
  if (adjDefRate !== 0) {
    nDefense = Math.floor(nDefense * (1.0 + adjDefRate / 100));
  }
  // ponytail: m_fDefence_Rate (NPC server config), armor-penetrate skill
  return Math.max(0, nDefense);
}

/**
 * `GetDamageMultiplier` (v19 `MoverAttack.cpp:998-1025`).
 *
 * Two terms:
 *  1. PvP flat 0.6 when both sides are players.
 *  2. v19 level-diff cosine falloff: `nDelta = defender.level - attacker.level`;
 *     when `nDelta > 0` AND either side is an NPC, cap nDelta at `MAX_OVER_ATK-1`
 *     (15) and multiply `factor *= cos(pi*nDelta/(MAX_OVER_ATK*2))`. At nDelta=15
 *     factor drops to ~0.098; at nDelta=0 factor is unchanged. Guards/super
 *     bosses (`RANK_GUARD`/`RANK_SUPER`) are exempt in C++ (nDelta forced 0);
 *     ponytail: re-add the rank exemption when monster ranks ship.
 *
 * (v15 had no level term here -- a prior revision added a fabricated cosine,
 * then removed it for v15 fidelity. v19 DOES ship the cosine, so it is restored.)
 */
export function getDamageMultiplier(attacker: Combatant, defender: Combatant): number {
  let factor = 1.0;
  if (defender.kind === 'player' && attacker.kind === 'player') factor *= 0.60; // PvP
  const MAX_OVER_ATK = 16;
  const nDelta = defender.level - attacker.level;
  if (nDelta > 0 && (attacker.kind === 'npc' || defender.kind === 'npc')) {
    const cap = Math.min(nDelta, MAX_OVER_ATK - 1);
    factor *= Math.cos((Math.PI * cap) / (MAX_OVER_ATK * 2));
  }
  return factor;
}

/** `MinusHP` (AttackArbiter.cpp:687) -- returns {newHp, damageActuallyDealt}. */
export function minusHP(currentHp: number, damage: number): { hp: number; dealt: number } {
  const hp = Math.max(0, currentHp - damage);
  return { hp, dealt: currentHp - hp };
}

/**
 * `CAttackArbiter::OnDamageMsgW` melee path -- the v1 entry point.
 *
 * Flow: hit-roll -> (miss => AF_MISS) -> CalcATK (GetHitPower w/ crit + element)
 * -> PostCalcGeneric (DEF subtract + block) -> GetDamageMultiplier -> MinusHP.
 */
export function resolveMelee(attacker: Combatant, defender: Combatant, rng: Rng): MeleeResult {
  let atkFlags = AF_GENERIC;
  const hitRate = getAttackResult(attacker, defender);
  if (rng.int(100) >= hitRate) {
    return { hit: false, damage: 0, atkFlags: atkFlags | AF_MISS };
  }

  // CalcATK -> GetHitPower (normal melee roll).
  const { min, max } = getHitMinMax(attacker);
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  let nATK = rng.range(lo, hi + 1); // xRandom(min,max) is [min,max); +1 for inclusive feel

  // Element factor (GetDamagePropertyFactor).
  const ef = elementFactor(attacker.weapon.element || attacker.element, defender.element);
  nATK = Math.floor((nATK * ef.atkFactor) / 10000);

  // Crit (IsCriticalAttack -> AF_CRITICAL1, flat 2.3* for v1).
  if (rng.int(100) < getCriticalProb(attacker)) {
    atkFlags |= AF_CRITICAL1;
    nATK = Math.floor(nATK * 2.3);
  }
  if (nATK < 0) nATK = 0;

  // PostCalcDamage (AttackArbiter.cpp:462-470): NPC melee ATK boost vs
  // higher-level player. +5% per level delta, applied BEFORE DEF subtract.
  if (attacker.kind === 'npc' && defender.kind === 'player') {
    const nDelta = attacker.level - defender.level;
    if (nDelta > 0) nATK = Math.floor(nATK * (1.0 + 0.05 * nDelta));
  }

  // PostCalcGeneric (melee): DEF subtract (element-adjusted), then block.
  let nDEF = Math.floor((calcDefense(defender, rng) * ef.defFactor) / 10000);
  let nDamage = nATK - nDEF;
  if (nDamage > 0) {
    const fBlock = getBlockFactor(defender, attacker, rng);
    if (fBlock < 1.0) {
      atkFlags |= AF_BLOCKING;
      nDamage = Math.floor(nDamage * fBlock);
    }
  } else {
    nDamage = 0;
  }
  // NPC -> player minimum damage rule (`PostCalcGeneric`, MoverAttack.cpp:1444):
  // a monster always deals at least 10% of its post-element/post-crit ATK,
  // regardless of DEF. Without this, any player whose DEF >= the mob's ATK is
  // immune -- the mob swings for 0 forever, stalling the in-combat logout gate
  // ("prevent quit when being attacked"). C++: `nMin = max(0, nATK*0.1)`.
  if (attacker.kind === 'npc' && defender.kind === 'player') {
    const nMin = Math.max(0, Math.floor(nATK * 0.1));
    if (nMin > nDamage) nDamage = nMin;
  }
  void nDEF;

  nDamage = Math.floor(nDamage * getDamageMultiplier(attacker, defender));
  if (nDamage <= 0) {
    atkFlags &= ~(AF_CRITICAL1);
    nDamage = 0;
  }
  return { hit: true, damage: nDamage, atkFlags };
}

/** `GetBlockFactor` (MoverAttack.cpp:731) -- NPC defender branch. */
function getBlockFactor(defender: Combatant, attacker: Combatant, rng: Rng): number {
  if (defender.kind === 'npc') {
    const r = rng.int(100);
    if (r <= 5) return 1.0;
    if (r >= 95) return 0.1;
    const nBR = Math.max(0, (defender.npcER - attacker.level) * 0.5);
    return nBR > r ? 0.2 : 1.0;
  }
  // Player defender branch -- unused until monsters swing.
  const r = rng.int(80);
  if (r <= 5) return 1.0;
  if (r >= 75) return 0.1;
  const job = getJobProps(defender.job);
  const nBR = Math.floor((defender.dex / 8) * job.fBlocking);
  return nBR > r ? 0.0 : 1.0;
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

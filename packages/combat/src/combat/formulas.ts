/**
 * v15 combat math -- pure port of the `CAttackArbiter` damage pipeline.
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
import type { JobProps, Rng } from '@flyff/entities';

// exp / vitals / rng moved to @flyff/entities -- re-export for transition.
export {
  expLevelDiffMult, expToNextLevel, addExp, subDieDecExp,
  withinLevelExp, cumulativeExp,
} from '@flyff/entities';
export type { ExpGainResult } from '@flyff/entities';
export { maxHitPoint, maxManaPoint, maxFatiguePoint, standRecovery } from '@flyff/entities';
export type { RecoveryAmount } from '@flyff/entities';
export type { Rng } from '@flyff/entities';
export { xRandomRng } from '@flyff/entities';

void ATK_SPEED_PLUS;

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
  /** Summed equip DEF (player armor; NPC = 0 -- uses `npcArmor`). */
  readonly equipDef: number;
  /** Flat hit-rate % from DST_ADJ_HITRATE (player jewelry/buffs; NPC = 0). */
  readonly adjHitRate: number;
  /** Evasion from DST_PARRY (player jewelry/buffs; NPC = 0). */
  readonly parry: number;
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
  const plus = getWeaponATK(c); // GetParam(DST_CHR_DMG,0) = 0 v1
  nMin += plus;
  nMax += plus;
  if (c.weapon.option > 0) {
    const v = Math.floor(Math.pow(c.weapon.option, 1.5));
    nMin += v;
    nMax += v;
  }
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

/** `GetCriticalProb` (MoverAttack.cpp:609) -- `(DEX/10) * job.fCritical`. */
export function getCriticalProb(c: Combatant): number {
  return Math.floor((c.dex / 10) * getJobProps(c.job).fCritical);
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
    rate = (HR * 1.5 / (HR + parry)) * 2.0 * (LVL * 0.5 / (LVL + defLVL * 0.3)) * 100;
  } else if (attacker.kind === 'npc' && defender.kind === 'player') {
    rate = (HR * 1.6 / (HR + parry)) * 1.5 * (LVL * 1.2 / (LVL + defLVL)) * 100;
  } else { // PvP
    rate = (HR * 1.6 / (HR + parry)) * 1.2 * (LVL * 1.2 / (LVL + defLVL)) * 100;
  }
  rate += attacker.adjHitRate; // nHitRate += GetAdjHitRate() (MoverAttack.cpp:273)
  return clamp(Math.floor(rate), MIN_HR, MAX_HR);
}

/** `CalcDefenseCore` (MoverAttack.cpp:573) -- NPC melee: `dwNaturalArmor/7 + 1`. */
export function calcDefense(defender: Combatant): number {
  if (defender.kind === 'npc') {
    return Math.floor(defender.npcArmor / 7.0) + 1;
  }
  // Player defender (CalcDefensePlayer melee) -- equip DEF + refine + STA/DEX/level.
  const job = getJobProps(defender.job);
  const byItem = defender.equipDef; // SumEquipDefenseAbility (armor DEF + refine bonus)
  return Math.floor((byItem + 0) * 2.3 + (defender.level + defender.sta / 2 + defender.dex) / 2.8 - 4 + defender.level * 2 + job.fFactorDef);
}

/** `GetDamageMultiplier` (MoverAttack.cpp:828) -- final multipliers. */
export function getDamageMultiplier(attacker: Combatant, defender: Combatant): number {
  let factor = 1.0;
  if (defender.kind === 'player' && attacker.kind === 'player') factor *= 0.60; // PvP
  // Level-diff cosine falloff (only when an NPC is involved).
  if (attacker.kind === 'npc' || defender.kind === 'npc') {
    const delta = defender.level - attacker.level;
    if (delta > 0) {
      const d = Math.min(delta, 15);
      factor *= Math.cos((Math.PI * d) / 32);
    }
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

  // PostCalcGeneric (melee): DEF subtract (element-adjusted), then block.
  let nDEF = Math.floor((calcDefense(defender) * ef.defFactor) / 10000);
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

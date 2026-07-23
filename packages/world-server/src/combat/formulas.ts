/**
 * v15 combat math -- pure port of the `CAttackArbiter` damage pipeline.
 *
 * Source: `docs/combat-research.md` #A/#B (canonical). All C++ function names
 * preserved as comments. Pure functions over {@link Combatant} views so the
 * math is unit-testable with hand-computed expected outputs.
 *
 * v1 scope: **player attacker -> NPC defender, normal melee (ATK_GENERIC)**.
 * Stubbed (`ponytail`): skills, stealHP, party-link, berserk, charge/range,
 * force/reflect, NPC-attacker + player-defender paths (monsters don't swing
 * yet -- lands with the AI system).
 *
 * @module combat/formulas
 */

import {
  getJobProps, ATK_SPEED_PLUS, elementFactor,
  AF_MISS, AF_CRITICAL1, AF_BLOCKING, AF_GENERIC,
  WT_MELEE_SWD, WT_MELEE_AXE, WT_MELEE_STICK, WT_MELEE_KNUCKLE,
  WT_MELEE_STAFF, WT_MAGIC_WAND, WT_MELEE_YOYO, WT_RANGE_BOW,
  MIN_HR, MAX_HR, NO_PROP,
} from './tables.js';
import type { JobProps } from './tables.js';
import { EXP_TABLE, MAX_LEVEL } from './expTable.js';

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

/** `xRandom` (MoverAttack.cpp) -- `[0,n)` / `[a,b)` int. Injectable for tests. */
export interface Rng {
  int(max: number): number;
  range(min: number, max: number): number;
}

/** Default rng -- `Math.random`-backed, matches `xRandom` semantics. */
export const xRandomRng: Rng = {
  int: (n) => Math.floor(Math.random() * n),
  range: (a, b) => a + Math.floor(Math.random() * (b - a)),
};

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

// --- exp / level (#D) --------------------------------------------------------

/**
 * `AddExperienceSolo` level-diff multiplier (Mover.cpp:6085).
 * `playerLevel - monsterLevel`: <=0->1.0, 1-2->0.7, 3-4->0.4, >=5->0.1.
 */
export function expLevelDiffMult(playerLevel: number, monsterLevel: number): number {
  const delta = playerLevel - monsterLevel;
  if (delta <= 0) return 1.0;
  if (delta <= 2) return 0.7;
  if (delta <= 4) return 0.4;
  return 0.1;
}

/**
 * Exp needed to advance FROM `level` TO `level+1` (delta of cumulative nExp1).
 * 0 if `level` is invalid or at/above the cap (no further progression).
 */
export function expToNextLevel(level: number): number {
  const cur = EXP_TABLE[level]?.nExp1;
  const next = EXP_TABLE[level + 1]?.nExp1;
  if (cur === undefined || next === undefined) return 0;
  return Math.max(0, next - cur);
}

export interface ExpGainResult {
  /** New level after applying `amount`. */
  readonly level: number;
  /** Remaining within-level exp (0 at exact level boundary). */
  readonly exp: number;
  /** Levels gained (0 if no level-up). */
  readonly levelsGained: number;
}

/**
 * `AddExperienceSolo` + `LevelUp` cascade. `exp` is **within-level** (progress
 * toward the next level, 0 at each boundary). Adds `amount`, then while enough
 * exp remains to advance, subtracts the per-level cost and levels up -- carrying
 * any excess into the next level. Caps at {@link MAX_LEVEL}.
 *
 * Pure: caller mutates the entity + fires side effects (HP/MP refill, packets,
 * persist) based on {@link ExpGainResult.levelsGained}.
 */
export function addExp(level: number, exp: number, amount: number): ExpGainResult {
  let newExp = exp + amount;
  let newLevel = level;
  while (newLevel < MAX_LEVEL) {
    const need = expToNextLevel(newLevel);
    if (need <= 0 || newExp < need) break;
    newExp -= need;
    newLevel++;
  }
  return { level: newLevel, exp: newExp, levelsGained: newLevel - level };
}

/**
 * `CMover::SubDieDecExp` (`_Common/Mover.cpp:7157`) -- the death exp penalty,
 * applied on **revive** (not on death itself). Subtracts a % of the exp needed
 * for the current level off the within-level `m_nExp`, clamped at 0.
 *
 * v15 C++ never de-levels here (`bLvDown` forcibly reset at `Mover.cpp:7189` --
 * the `__VER < 8` guard is commented out), so the level is unchanged.
 *
 * Loss % by level bracket -- simplified from `DiePenalty.inc:35-60`
 * (`DECEXP_PENALTY` table: Lv<=20=0%, Lv<=29=6%, Lv<=59=5%, Lv<=89=4%, Lv<=99=3%,
 * Lv<=109=2%, Lv<=129=1.5%, Lv<=200=1%). Throws on invalid level.
 *
 * ponytail: load the real `DiePenalty.inc` table when the resource converter
 * exports it; the bracket values then come from data, not code.
 *
 * Pure: caller journals + mutates the entity + fires the SETEXPERIENCE packet.
 */
export function subDieDecExp(level: number, exp: number): { level: number; exp: number } {
  const pct = deathExpLossPct(level);
  if (pct <= 0) return { level, exp: Math.max(0, exp) };
  const loss = Math.floor(expToNextLevel(level) * pct);
  return { level, exp: Math.max(0, exp - loss) };
}

/** `DECEXP_PENALTY` bracket -- % of current-level exp lost on town revive. */
function deathExpLossPct(level: number): number {
  if (level <= 20) return 0;
  if (level <= 29) return 0.06;
  if (level <= 59) return 0.05;
  if (level <= 89) return 0.04;
  if (level <= 99) return 0.03;
  if (level <= 109) return 0.02;
  if (level <= 129) return 0.015;
  return 0.01;
}

/**
 * Within-level exp = cumulative exp - the level's `nExp1` base. Used to convert
 * the cumulative value stored in the DB / sent on the wire into the live
 * within-level `m_nExp`. Clamps >= 0 (a malformed row cannot give negative exp).
 */
export function withinLevelExp(cumulativeExp: number, level: number): number {
  const base = EXP_TABLE[level]?.nExp1 ?? 0;
  return Math.max(0, cumulativeExp - base);
}

/**
 * Cumulative exp = level's `nExp1` base + within-level exp. The SETEXPERIENCE
 * snapshot (`nExp1`) and the DB `exp` column both store cumulative, per the C++
 * `m_nExp1` semantics.
 */
export function cumulativeExp(level: number, exp: number): number {
  return (EXP_TABLE[level]?.nExp1 ?? 0) + exp;
}

// --- vitals recovery (#E) ----------------------------------------------------

/**
 * `CMover::GetMaxOriginHitPoint` player branch (`MoverParam.cpp:2871`):
 *   a = fFactorMaxHP * level / 2
 *   b = a * ((level+1)/4) * (1 + sta/50) + sta*10
 *   maxHP = b + 80
 * The DB `max_hp`/`max_mp` columns are stale caches -- the client computes this formula
 * itself and displays the result (e.g. 236 at lvl 1 vagrant), so the server
 * MUST derive max the same way or regen clamps against a wrong ceiling and
 * HP/MP/FP never visibly recover. Pure; caller assigns + syncs.
 */
export function maxHitPoint(level: number, sta: number, fFactorMaxHP: number): number {
  const lv = Math.max(1, level);
  const a = (fFactorMaxHP * lv) / 2.0;
  const b = a * ((lv + 1.0) / 4.0) * (1.0 + sta / 50.0) + sta * 10.0;
  return Math.floor(b + 80.0);
}

/**
 * `CMover::GetMaxOriginManaPoint` player branch (`MoverParam.cpp:2904`):
 *   maxMP = (((level*2) + (int*8)) * fFactorMaxMP) + 22 + (int * fFactorMaxMP)
 * Same reasoning as `maxHitPoint` -- DB `max_mp` is a stale cache, derive live.
 */
export function maxManaPoint(level: number, int_: number, fFactorMaxMP: number): number {
  const lv = Math.max(1, level);
  return Math.floor((((lv * 2.0) + int_ * 8.0) * fFactorMaxMP) + 22.0 + int_ * fFactorMaxMP);
}

/**
 * `CMover::GetMaxFatiguePoint` player base (`MoverParam.cpp:2910/2932`):
 *   `((level*2 + sta*6) * fFactorMaxFP) + (sta * fFactorMaxFP)`
 */
export function maxFatiguePoint(level: number, sta: number, fFactorMaxFP: number): number {
  const lv = Math.max(1, level);
  return Math.floor((lv * 2.0 + sta * 6.0) * fFactorMaxFP + sta * fFactorMaxFP);
}

/**
 * Stand regen amounts per 3 s tick (`ProcessRecovery` stand branch,
 * `Mover.cpp:8381`, formulas `MoverParam.cpp:2972/2989/3006`). The v9+ `__RECOVERY10`
 * `-10%` is baked in via the trailing `* 0.9`. `level` is clamped `>= 1` to guard
 * the `/ (500*level)` term. Pure: the caller mutates the entity + sends the
 * SETPOINTPARAM sync (`RecoverySystem`). Negatives clamp to 0.
 */
export interface RecoveryAmount { readonly hp: number; readonly mp: number; readonly fp: number; }

export function standRecovery(
  level: number,
  sta: number,
  int_: number,
  maxHp: number,
  maxMp: number,
  maxFp: number,
  job: JobProps,
): RecoveryAmount {
  const lv = Math.max(1, level);
  const hp = Math.floor(((lv / 3) + maxHp / (500 * lv) + sta * job.fFactorHPRec) * 0.9);
  const mp = Math.floor(((lv * 1.5 + maxMp / (500 * lv) + int_ * job.fFactorMPRec) * 0.2) * 0.9);
  const fp = Math.floor(((lv * 2 + maxFp / (500 * lv) + sta * job.fFactorFPRec) * 0.2) * 0.9);
  return { hp: Math.max(0, hp), mp: Math.max(0, mp), fp: Math.max(0, fp) };
}

void NO_PROP;

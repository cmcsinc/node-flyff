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
  AF_MISS, AF_CRITICAL1, AF_CRITICAL, AF_FLYING, AF_BLOCKING, AF_GENERIC, AF_FORCE,
  AF_MELEESKILL, AF_MAGICSKILL, MAX_CHARGE_LEVEL,
  SI_BIL_PST_ASALRAALAIKUM, SI_JST_YOYO_HITOFPENYA,
  WT_MELEE_SWD, WT_MELEE_AXE, WT_MELEE_STICK, WT_MELEE_KNUCKLE,
  WT_MELEE_STAFF, WT_MAGIC_WAND, WT_MELEE_YOYO, WT_RANGE_BOW,
  RANK_MIDBOSS, RANK_MATERIAL, RANK_SUPER,
  MIN_HR, MAX_HR,
} from './tables';
import { getJobProps } from '@flyff/entities';
import type { Rng, ParamView } from '@flyff/entities';
import { DST } from '@flyff/entities';

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
  /**
   * Defender-only: raw propMover `dwClass` rank (`defineAttribute.h:184-194`).
   * Read by the crit knock-up gate `CanFlyByAttack` (`MoverAttack.cpp:141`),
   * which exempts RANK_SUPER (7) / RANK_MATERIAL (6) / RANK_MIDBOSS (5).
   * Player/absent = 0 (never exempt).
   */
  readonly rank?: number | undefined;
  /**
   * Defender-only: air mover (propMover `bFlying` -> `IsFlyingNPC()`). Flying
   * movers can never be knocked up (`CanFlyByAttack` early-returns FALSE).
   */
  readonly flyable?: boolean | undefined;
  /**
   * Attacker-only: already-consumed party critical bonus, added flat to
   * `getCriticalProb`. C++ `GetCriticalProb` (`MoverAttack.cpp:698-707`) does the
   * `g_PartyMng` lookup inline and adds `pParty->m_nSizeofMember / 2` when the
   * one-shot `MVRF_CRITICAL` flag is armed, then clears the flag. Here the
   * lookup + clear happen in the service seam (`@flyff/combat` holds no
   * `@flyff/party` import) and only the resulting integer arrives. Absent/0 = no
   * bonus, which is also the steady state until a party-skill system ships.
   */
  readonly partyCritBonus?: number | undefined;
}

export interface MeleeResult {
  readonly hit: boolean;
  readonly damage: number;
  readonly atkFlags: number;
}

/** Inputs to {@link applyDpc} -- the POSTCALC_DPC sink (`ApplyDPC`). */
export interface DpcInputs {
  readonly attacker: Combatant;
  readonly defender: Combatant;
  /** Post-`CalcATK` attack power (element factor + DST_ATKPOWER already folded). */
  readonly nATK: number;
  /** Flags so far; `AF_CRITICAL`/`AF_FLYING` may be added by this call. */
  readonly atkFlags: number;
  readonly rng: Rng;
  /** Skill id for `CanIgnoreDEF` (0 = not a skill attack). */
  readonly skillId?: number | undefined;
  /** `GetChargeLevel()` -- wand/bow charge, 0 for skills. */
  readonly chargeLevel?: number | undefined;
  /** Attacker act-state carries `OBJSTA_ATK4` (4th combo swing). */
  readonly atk4?: boolean | undefined;
}

export interface DpcResult {
  readonly damage: number;
  readonly atkFlags: number;
}

// --- stat getters (#A) -------------------------------------------------------

/** `GetWeaponATK` (MoverAttack.cpp:371) -- STR/level scaling per weapon type + `GetPlusWeaponATK` (weapon mastery). */
export function getWeaponATK(c: Combatant): number {
  const job = getJobProps(c.job);
  const LVL = c.level, STR = c.str, INT = c.int;
  let nATK: number;
  switch (c.weapon.type) {
    case WT_MELEE_SWD:     nATK = (STR - 12) * job.fMeleeSWD + LVL * 1.1; break;
    case WT_MELEE_AXE:     nATK = (STR - 12) * job.fMeleeAXE + LVL * 1.2; break;
    case WT_MELEE_STICK:   nATK = (STR - 10) * job.fMeleeSTICK + LVL * 1.3; break;
    case WT_MELEE_KNUCKLE: nATK = (STR - 10) * job.fMeleeKNUCKLE + LVL * 1.2; break;
    case WT_MELEE_STAFF:   nATK = (STR - 10) * job.fMeleeSTAFF + LVL * 1.1; break;
    case WT_MAGIC_WAND:    nATK = (INT - 10) * job.fMagicWAND + LVL * 1.2; break;
    case WT_MELEE_YOYO:    nATK = (STR - 12) * job.fMeleeYOYO + LVL * 1.1; break;
    case WT_RANGE_BOW:     nATK = ((c.dex - 14) * 4.0 + LVL * 1.3 + STR * 0.2) * 0.7; break;
    default:               nATK = (STR - 12) * job.fMeleeSWD + LVL * 1.1; break; // bare-hand -> sword curve
  }
  // GetPlusWeaponATK (MoverAttack.cpp:359) -- weapon mastery DST bonuses.
  // ponytail: only common weapon types; rare types (staff, wand, stick) have no C++ DST.
  nATK += getPlusWeaponATK(c);
  return nATK;
}

/** `GetPlusWeaponATK` (MoverAttack.cpp:359) -- weapon mastery DST lookup. */
function getPlusWeaponATK(c: Combatant): number {
  switch (c.weapon.type) {
    case WT_MELEE_SWD:     return c.params.get(DST.SWD_DMG, 0);
    case WT_MELEE_AXE:     return c.params.get(DST.AXE_DMG, 0);
    case WT_MELEE_KNUCKLE: return c.params.get(DST.KNUCKLE_DMG, 0);
    case WT_MELEE_YOYO:    return c.params.get(DST.YOY_DMG, 0);
    case WT_RANGE_BOW:     return c.params.get(DST.BOW_DMG, 0);
    default:               return 0; // no mastery DST for stick, staff, wand
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
  // DST_ATKPOWER_RATE (%) -- percentage modifier within GetHitMinMax.
  // ponytail: DST_ATKPOWER (flat) moved to resolveMelee (M3: C++ CalcATK:334)
  //   to match pipeline position: after GetATKMultiplier + element factor.
  const atkRate = c.params.get(DST.ATKPOWER_RATE, 0);
  if (atkRate !== 0) { nMin *= 1 + atkRate / 100; nMax *= 1 + atkRate / 100; }
  return { min: Math.floor(nMin), max: Math.floor(nMax) };
}

/** `GetHR` (MoverAttack.cpp:233) -- DEX (player) / `dwHR` (NPC). */
export function getHR(c: Combatant): number {
  return c.kind === 'player' ? c.dex : c.npcHR;
}

/**
 * `GetAdjHitRate` (MoverParam.cpp:549) -- `GetParam( DST_ADJ_HITRATE, m_nAdjHitRate )`.
 *
 * `c.adjHitRate` is the propItem-column base (`nAdjHitRate`, col 49) summed over
 * equipped parts; the DST layer on top is where the real data lives -- every one
 * of the 5716 propItem rows leaves col 49 empty, while 441 armour/weapon rows
 * carry `dst: 47`, and Hawkeye-style buffs write the same slot.
 */
export function getAdjHitRate(c: Combatant): number {
  return c.params.get(DST.ADJ_HITRATE, c.adjHitRate);
}

/** `GetParrying` (MoverParam.cpp:555) -- `DEX/2 + GetParam(DST_PARRY, m_nAdjParry)` (player) / `dwER` (NPC). */
export function getParrying(c: Combatant): number {
  if (c.kind !== 'player') return c.npcER;
  return Math.floor(c.dex * 0.5 + c.params.get(DST.PARRY, c.parry));
}

/**
 * `GetCriticalProb` (MoverAttack.cpp:684) -- `(DEX/10) * job.fCritical`, then
 * `GetParam(DST_CHR_CHANCECRITICAL, that)` as OVERRIDE, then the one-shot party
 * bonus.
 */
export function getCriticalProb(c: Combatant): number {
  // GetParam(dst, nProb): chg-override > adj + nProb > nProb -- the base roll is
  // the DEFAULT, so DST_CHR_CHANCECRITICAL replaces it, never adds. C++ also
  // clamps negatives to 0 (__JEFF_11).
  let nProb = Math.floor((c.dex / 10) * getJobProps(c.job).fCritical);
  nProb = c.params.get(DST.CHR_CHANCECRITICAL, nProb);
  if (nProb < 0) nProb = 0;
  // Party SphereCircle bonus (MoverAttack.cpp:697-707): `+= m_nSizeofMember/2`
  // when MVRF_CRITICAL is armed. Added AFTER the negative clamp and AFTER the
  // DST override, so it stacks on top of a chg-override. The caller consumes
  // the one-shot flag (`CombatService.takePartyCritBonus`).
  return nProb + (c.partyCritBonus ?? 0);
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
 * `GetAttackResult` (MoverAttack.cpp:316) -- server-authoritative hit roll.
 * Clamp `[MIN_HR, MAX_HR]`; `hit = xRandom(100) < nHitRate`.
 *
 * The branch result is truncated to int BEFORE `GetAdjHitRate()` is added
 * (`nHitRate = (int)(...)` then `nHitRate += ...`, C++ :330/:348), so a +20 buff
 * moves the rate by exactly 20 points -- flooring the sum instead would drop a
 * fractional point.
 *
 * ponytail: the `IsNPC() && pDefender->IsPlayer()` branch below still carries the
 * player->NPC coefficients (`*1.6 / *1.5`, level term `LVL*1.2/(LVL+defLVL)`)
 * instead of the C++ NPC ones (`*1.5 / *2.0`, level term
 * `LVL*0.5/(LVL + defLVL*0.3)`, MoverAttack.cpp:330-331). Correcting it changes
 * how often monsters land a hit, so it is left for a separate, deliberate pass.
 */
export function getAttackResult(attacker: Combatant, defender: Combatant): number {
  const HR = getHR(attacker);
  const parry = getParrying(defender);
  const LVL = attacker.level, defLVL = defender.level;
  let rate: number;
  if (attacker.kind === 'player' && defender.kind === 'npc') {
    // MoverAttack.cpp:335-336 -- Player->NPC hit rate
    rate = (HR * 1.6 / (HR + parry)) * 1.5 * (LVL * 1.2 / (LVL + defLVL)) * 100;
  } else if (attacker.kind === 'npc' && defender.kind === 'player') {
    rate = (HR * 1.6 / (HR + parry)) * 1.5 * (LVL * 1.2 / (LVL + defLVL)) * 100;
  } else { // PvP -- MoverAttack.cpp:344-345
    rate = (HR * 1.6 / (HR + parry)) * 1.2 * (LVL * 1.2 / (LVL + defLVL)) * 100;
  }
  // nHitRate += GetAdjHitRate() (MoverAttack.cpp:348), after the (int) cast.
  return clamp(Math.floor(rate) + getAdjHitRate(attacker), MIN_HR, MAX_HR);
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
 * Knock-up eligibility -- the three guards around the 15% roll in `GetHitPower`
 * (`MoverAttack.cpp:1464-1470`) folded together with `CMover::CanFlyByAttack`
 * (`MoverAttack.cpp:141-155`).
 *
 * Blocked when: the attacker's active hand is a yoyo, the hit carries
 * `AF_FORCE`, the defender is a player, the defender is an air mover
 * (`IsFlyingNPC()`), or the defender's `dwClass` is RANK_SUPER (7) /
 * RANK_MATERIAL (6) / RANK_MIDBOSS (5).
 *
 * ponytail: `CanFlyByAttack` also returns FALSE while the defender is already
 *   in `OBJSTA_DMG_FLY_ALL` (no repeat knock-up mid-flight) and for a defender
 *   whose ActMover `IsFly()`. Neither act-state exists server-side yet -- the
 *   effect is that a mob already airborne can be re-launched.
 */
function canFlyByAttack(attacker: Combatant, defender: Combatant, atkFlags: number): boolean {
  if (attacker.weapon.type === WT_MELEE_YOYO) return false;
  if (atkFlags & AF_FORCE) return false;
  if (defender.kind === 'player') return false;
  if (defender.flyable) return false;
  const rank = defender.rank ?? 0;
  return rank !== RANK_SUPER && rank !== RANK_MATERIAL && rank !== RANK_MIDBOSS;
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
  let { min, max } = getHitMinMax(attacker);

  // C3: crit is a PRE-ROLL min/max variance layer (`GetHitPower`,
  // MoverAttack.cpp:1429-1460), not a post-roll multiplier. The flat 2.3x/2.6x
  // layer lives in `ApplyDPC` (MoverAttack.cpp:1645) -- reachable only from the
  // POSTCALC_DPC branch (AttackArbiter.cpp:476), which needs an attack carrying
  // neither AF_GENERIC nor AF_MAGICSKILL. Generic melee sets AF_GENERIC
  // (ActionMoverMsg.cpp:698) -> POSTCALC_GENERIC, so THIS path never reaches it
  // (melee skills and wand auto-attacks do -- see `applyDpc`). Hence no *2.3 here.
  if (rng.int(100) < getCriticalProb(attacker)) {
    atkFlags |= AF_CRITICAL1;
    let fMin = 1.1;
    let fMax = 1.4;
    if (attacker.level > defender.level) {
      // v19 __PVPDEMAGE0608 gates the wide range on an NPC defender.
      if (defender.kind === 'npc') { fMin = 1.2; fMax = 2.0; }
      // NPC attacker overrides (narrower band).
      if (attacker.kind === 'npc') { fMin = 1.4; fMax = 1.8; }
    }
    // fCriticalBonus = 1 + GetParam(DST_CRITICAL_BONUS,0)/100, floored 0.1 (__JEFF_11).
    let fCriticalBonus = 1 + attacker.params.get(DST.CRITICAL_BONUS, 0) / 100.0;
    if (fCriticalBonus < 0.1) fCriticalBonus = 0.1;
    min = Math.trunc(min * fMin * fCriticalBonus);
    max = Math.trunc(max * fMax * fCriticalBonus);
    // AF_FLYING knock-up (`GetHitPower`, MoverAttack.cpp:1462-1480, live
    // __VER >= 9 / __FLYBYATTACK0608 branch -- the pre-9 roll was 30). Rolled
    // ONLY inside the crit branch, so a non-crit hit never knocks up.
    if (canFlyByAttack(attacker, defender, atkFlags) && rng.int(100) < 15) {
      atkFlags |= AF_FLYING;
    }
  }

  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  let nATK = rng.range(lo, hi + 1); // xRandom(min,max) is [min,max); +1 for inclusive feel

  // Element factor (GetDamagePropertyFactor).
  const ef = elementFactor(attacker.weapon.element || attacker.element, defender.element);
  nATK = Math.floor((nATK * ef.atkFactor) / 10000);

  // M3: DST_ATKPOWER (flat) applied after element factor (CalcATK:334).
  nATK += attacker.params.get(DST.ATKPOWER, 0);
  if (nATK < 0) nATK = 0;

  // PostCalcDamage (AttackArbiter.cpp:462-470): NPC melee ATK boost vs
  // higher-level player. +5% per level delta, applied BEFORE DEF subtract.
  if (attacker.kind === 'npc' && defender.kind === 'player') {
    const nDelta = attacker.level - defender.level;
    if (nDelta > 0) nATK = Math.floor(nATK * (1.0 + 0.05 * nDelta));
  }

  // PostCalcGeneric (melee): DEF subtract (element-adjusted), then block.
  const nDEF = Math.floor((calcDefense(defender, rng) * ef.defFactor) / 10000);
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
    // PostCalcGeneric (MoverAttack.cpp:1533): clears the full AF_CRITICAL mask
    // (both 1 and 2) AND AF_FLYING -- not just AF_CRITICAL1.
    atkFlags &= ~(AF_CRITICAL | AF_FLYING);
    nDamage = 0;
  }
  // `nDamage += GetWeaponPlusDamage(nDamage)` sits here in PostCalcGeneric
  // (MoverAttack.cpp:1526), but the v19 global sink (MoverAttack.cpp:117-138)
  // is `return 0;` unconditionally -- enchant raises ATK now instead of paying
  // out as an option value. Faithful port = add nothing. Not a missing feature.
  return { hit: true, damage: nDamage, atkFlags };
}

/**
 * `CMover::ApplyDPC` (`MoverAttack.cpp:1645`) -- the POSTCALC_DPC damage sink.
 * A **defender** method: `this` is the mover taking the hit.
 *
 * `GetPostCalcType` (`AttackArbiter.cpp:434-450`) routes here for every attack
 * that carries neither `AF_MAGICSKILL` nor `AF_GENERIC` -- i.e. melee skills
 * (`Ctrl.cpp:1024-1031` sets only `AF_MELEESKILL`) and bare-`AF_MAGIC` wand
 * auto-attacks (`MoverActEvent.cpp:859`). Generic melee sets `AF_GENERIC` and
 * goes to `PostCalcGeneric` instead, which is why `resolveMelee` never calls
 * this.
 *
 * Verbatim shape:
 *   1. `CanIgnoreDEF()` ? nATK : nATK - CalcDefense, clamped >= 0.
 *   2. `IsCriticalAttack(defender, flags)` -- FALSE for any skill attack
 *      (`MoverAttack.cpp:798-804`), so only the wand path can crit here.
 *   3. Crit sets the FULL `AF_CRITICAL` mask (not just `AF_CRITICAL1`), then
 *      `*2.6` + 50% fly roll when `OBJSTA_ATK4` or charge == MAX_CHARGE_LEVEL,
 *      else `*2.3` + 30% fly roll. (Note the 15% in `GetHitPower` differs.)
 *   4. `fCriticalBonus = 1 + DST_CRITICAL_BONUS/100`, floored at 0.1 (__JEFF_11).
 *
 * `CalcPropDamage` (`AttackArbiter.cpp:477-480`) is deliberately absent: it is
 * `#if __VER < 13` and WORLDSERVER is `__VER 19` (`VersionCommon.h:4`), so it
 * is not compiled. Adding it would be a divergence, not a missing feature.
 */
export function applyDpc(opts: DpcInputs): DpcResult {
  const { attacker, defender, rng } = opts;
  let atkFlags = opts.atkFlags;

  let nDamage: number;
  if (canIgnoreDef(atkFlags, opts.skillId ?? 0)) {
    nDamage = opts.nATK;
  } else {
    nDamage = opts.nATK - calcDefense(defender, rng);
  }
  if (nDamage < 0) nDamage = 0;

  // IsCriticalAttack (MoverAttack.cpp:798-804): skill attacks never crit.
  const isSkill = (atkFlags & (AF_MELEESKILL | AF_MAGICSKILL)) !== 0;
  if (!isSkill && rng.int(100) < getCriticalProb(attacker)) {
    atkFlags |= AF_CRITICAL;
    const maxCharge = opts.atk4 === true || (opts.chargeLevel ?? 0) === MAX_CHARGE_LEVEL;
    const flyProb = maxCharge ? 50 : 30;
    nDamage = Math.trunc(nDamage * (maxCharge ? 2.6 : 2.3));
    if (canFlyByAttack(attacker, defender, atkFlags) && rng.int(100) < flyProb) {
      atkFlags |= AF_FLYING;
    }
    let fCriticalBonus = 1 + attacker.params.get(DST.CRITICAL_BONUS, 0) / 100.0;
    if (fCriticalBonus < 0.1) fCriticalBonus = 0.1;
    nDamage = Math.trunc(nDamage * fCriticalBonus);
  }
  return { damage: nDamage, atkFlags };
}

/** `ATTACK_INFO::CanIgnoreDEF` (`AttackArbiter.cpp:56-69`). */
function canIgnoreDef(atkFlags: number, skillId: number): boolean {
  if (atkFlags & AF_FORCE) return true;
  return skillId === SI_BIL_PST_ASALRAALAIKUM || skillId === SI_JST_YOYO_HITOFPENYA;
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
  // Player defender branch (MoverAttack.cpp:808-835).
  const r = rng.int(80);
  if (r <= 5) return 1.0;
  if (r >= 75) return 0.1;
  const defLVL = defender.level, atkLVL = attacker.level;
  const defDex = defender.dex, atkDex = attacker.dex;
  // Attacker-dependent blocking terms (C++ fBlockA + fBlockB).
  const fBlockA = defLVL / ((defLVL + atkLVL) * 15.0);
  let fBlockB = (defDex + atkDex + 2) * ((defDex - atkDex) / 800.0);
  if (fBlockB > 10.0) fBlockB = 10.0;
  let fAdd = fBlockA + fBlockB;
  if (fAdd < 0.0) fAdd = 0.0;
  // ponytail: DST_BLOCK_RANGE/DST_BLOCK_MELEE (range-attack flag not yet on Combatant);
  //   add when ranged attack types ship.
  const job = getJobProps(defender.job);
  let nBR = Math.floor((defDex / 8.0) * job.fBlocking + fAdd);
  if (nBR < 0) nBR = 0;
  return nBR > r ? 0.0 : 1.0;
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

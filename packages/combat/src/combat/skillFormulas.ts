/**
 * v19 skill damage formulas -- pure port of the `GetMeleeSkillPower` +
 * `GetMagicSkillPower` + `PostCalcMagicSkill` chain.
 *
 * Source: `docs/skills-research.md` #4 (canonical). Skill damage **reuses the
 * melee `CAttackArbiter::CalcDamage`** pipeline -- the only difference is the
 * ATK source: `GetMeleeSkillPower`/`GetMagicSkillPower` replace `GetHitPower`.
 *
 * v1 scope: single-target **damage only** (EXT_MELEEATK + EXT_MAGICATKSHOT).
 * No heal/buff/AoE/multihit/projectile -- those are ponytail.
 *
 * @module combat/skillFormulas
 */

import type { Combatant, Rng, MeleeResult } from './formulas';
import { calcDefense, getDamageMultiplier } from './formulas';
import { DST } from '@flyff/entities';
import type { SkillDefinition, SkillLevel } from '@flyff/resources';
import {
  AF_GENERIC, AF_MELEESKILL, AF_MAGICSKILL, AF_CRITICAL1,
} from './tables';

/**
 * Magic skill element factor -- **separate from `ELEMENT_MATCH`**
 * (`MoverAttack.cpp:1275`). 6*6 cycle: same = 1.1, attacker beats = 0.9,
 * else 1.0. The cycle is 1>2, 2>3, 3>5, 5>4, 4>1 (Fire>Water>Electricity>
 * Earth>Wind>Fire). docs #4.
 *
 * Indexed as `[defenderElement][attackerElement]`. `0` (NO_PROP) is neutral
 * vs everything (factor 1.0).
 *
 * Element enum (`defineAttribute.h` ST_* -> internal): MAGIC=1 (not used here),
 * FIRE=0x04->1, WATER=0x20->2, ELECTRICITY=0x02->3, WIND=0x10->4, EARTH=0x08->5
 * (v19 bit flags; see `ST_TO_INTERNAL`). We index by the 1..5 numeric element
 * id post-conversion.
 */
// ponytail: convert ST_* resource values to the 1..5 internal index via a
// shared table once more than fire/water/electric/wind/earth appear.
const MAGIC_FACTOR_BEATS: ReadonlySet<string> = new Set([
  '1>2', // Fire beats Water
  '2>3', // Water beats Electricity
  '3>5', // Electricity beats Earth
  '5>4', // Earth beats Wind
  '4>1', // Wind beats Fire
]);

/** Resolve the magic-skill factor for attacker/defender elements (1..5). */
export function getMagicSkillFactor(atkElement: number, defElement: number): number {
  if (atkElement === defElement) return 1.1;
  const key = `${String(atkElement)}>${String(defElement)}`;
  if (MAGIC_FACTOR_BEATS.has(key)) return 0.9;
  return 1.0;
}

/**
 * Map ST_* resource element value -> 1..5 internal magic-factor index.
 *
 * v19 `defineAttribute.h` encodes `ST_*` as **bit flags** (combinable, e.g.
 * `ST_ELECFIRE = ST_ELECTRICITY|ST_FIRE = 0x06`), NOT the sequential ordinals
 * older clients used (FIRE=5, WATER=7, ...). v19 values: FIRE=0x04, WATER=0x20,
 * ELECTRICITY=0x02, WIND=0x10, EARTH=0x08. Single-element skills carry one bit,
 * so the map keys are the bare flag values.
 */
const ST_TO_INTERNAL: ReadonlyMap<number, number> = new Map([
  [0x04, 1], // ST_FIRE
  [0x20, 2], // ST_WATER
  [0x02, 3], // ST_ELECTRICITY
  [0x10, 4], // ST_WIND
  [0x08, 5], // ST_EARTH
]);

/**
 * `GetMeleeSkillPower` (`MoverAttack.cpp:1460`) -- shared ATK source for melee
 * AND magic skills (GetMagicSkillPower just adds +DST_ADDMAGIC + mastery).
 *
 * ```
 * nReferStat = referStat1 + referStat2     // RT_ATTACK: (dwReferValue/10)*stat + skillLvl*(stat/50)
 * fPowerMin = ((weaponMin + (abilityMin + nAddSkillMin)*5 + nReferStat - 20) * (16+skillLvl)/13)
 * fPowerMax = ((weaponMax + (abilityMax + nAddSkillMax)*5 + nReferStat - 20) * (16+skillLvl)/13)
 * + GetPlusWeaponATK + GetParam(DST_CHR_DMG)
 * return fPowerMin + xRandom(fPowerMax - fPowerMin + 1)
 * ```
 *
 * `nAddSkillMin/Max` (dwAddSkillMin/Max) are v9 weapon-mastery fields -- we read
 * them from the base skill; defaults to 0 when not present.
 *
 * v1: GetPlusWeaponATK + DST_CHR_DMG both 0 (no equip-mastery + no buff model).
 */
export function getMeleeSkillPower(
  attacker: Combatant,
  skill: SkillDefinition,
  level: SkillLevel,
): { min: number; max: number } {
  const skillLvl = level.level;
  const rts = skill.referTargets ?? [0, 0];
  const rss = skill.referStats ?? [0, 0];
  const rvs = skill.referValues ?? [0, 0];

  // Per-referStat: RT_ATTACK scaling is `(dwReferValue/10)*stat + skillLvl*(stat/50)`.
  // Other RT_* (TIME, HEAL) use a flat dwReferValue*skillLvl curve -- ponytail.
  let nReferStat = 0;
  for (let i = 0; i < 2; i++) {
    const rt = rts[i] ?? 0;
    const rs = rss[i] ?? 0;
    const rv = rvs[i] ?? 0;
    if (rt !== 1) continue; // RT_ATTACK only v1
    const stat = statForRefer(attacker, rs);
    nReferStat += Math.floor(rv / 10) * stat + skillLvl * Math.floor(stat / 50);
  }

  const abilityMin = level.abilityMin ?? 0;
  const abilityMax = level.abilityMax ?? 0;
  // dwAddSkillMin/Max come from the BASE skill, not per-level. They aren't on
  // our SkillDefinition (only relevant for v9 weapon-mastery skills) -- default 0.
  const nAddSkillMin = 0;
  const nAddSkillMax = 0;

  const wMin = attacker.weapon.min;
  const wMax = attacker.weapon.max;
  const scalar = (16 + skillLvl) / 13;
  const fPowerMin = (wMin + (abilityMin + nAddSkillMin) * 5 + nReferStat - 20) * scalar;
  const fPowerMax = (wMax + (abilityMax + nAddSkillMax) * 5 + nReferStat - 20) * scalar;

  return { min: Math.floor(fPowerMin), max: Math.floor(fPowerMax) };
}

/**
 * `GetMagicSkillPower` (`MoverAttack.cpp:1025`) -- GetMeleeSkillPower + DST_ADDMAGIC
 * + element mastery. v1: DST_ADDMAGIC=0 (no equip model), DST_MASTRY_<elem>=0
 * (no mastery). So it's just GetMeleeSkillPower in practice.
 */
export function getMagicSkillPower(
  attacker: Combatant,
  skill: SkillDefinition,
  level: SkillLevel,
): { min: number; max: number } {
  const base = getMeleeSkillPower(attacker, skill, level);
  // DST_ADDMAGIC flat bonus + element mastery (DST_MASTRY_<elem>). C++ adds
  // these on top of GetMeleeSkillPower (MoverAttack.cpp:1025). Mastery is keyed
  // by the skill's element; ponytail: full mastery table once skills carry
  // element + level.
  const addMagic = attacker.params.get(DST.ADDMAGIC, 0);
  if (addMagic === 0) return base;
  return { min: base.min + addMagic, max: base.max + addMagic };
}

/**
 * `PostCalcMagicSkill` (`MoverAttack.cpp:1096`) -- magic-specific defense path.
 *
 * ```
 * nDEF = defender.CalcDefense                  // same as melee
 * nATK -= nATK * GetParam(DST_RESIST_MAGIC_RATE)/100   // v1: 0
 * a = (nATK - nDEF) * (1 - GetResist(skillElement))    // v1: 0
 * return a * GetMagicSkillFactor(defender, skillElement)
 * ```
 *
 * v1: RESIST_MAGIC_RATE=0, defender elemental resist=0 -> straight subtraction
 * + element cycle factor.
 *
 * Returns final damage (>=0).
 */
export function postCalcMagicSkill(
  nATK: number,
  defender: Combatant,
  defenderDef: number,
  skillElement: number,
): number {
  // nATK -= nATK * GetParam(DST_RESIST_MAGIC_RATE)/100
  const resistRate = defender.params.get(DST.RESIST_MAGIC_RATE, 0);
  const atk = resistRate > 0 ? nATK - nATK * resistRate / 100 : nATK;
  let a = atk - defenderDef;
  if (a < 0) a = 0;
  // (1 - GetResist(skillElement)) -- defender elemental resist via DST_RESIST_<elem>.
  const elemResist = getResist(defender, skillElement);
  if (elemResist > 0) a = a * (1 - elemResist / 100);
  const internalElem = ST_TO_INTERNAL.get(skillElement) ?? 0;
  const defInternal = ST_TO_INTERNAL.get(defender.element) ?? 0;
  const factor = internalElem > 0 ? getMagicSkillFactor(internalElem, defInternal) : 1.0;
  return Math.floor(a * factor);
}

/**
 * `GetResist(element)` (`MoverParam.cpp`) -- defender elemental resist % from
 * `DST_RESIST_<elem>` params (0..100). `skillElement` is the ST_* value; mapped
 * to its DST_RESIST_* id. Returns 0 for NO_PROP/unknown.
 */
function getResist(defender: Combatant, skillElement: number): number {
  const dst = RESIST_DST_BY_ELEMENT.get(skillElement);
  if (dst === undefined) return 0;
  return defender.params.get(dst, 0);
}

/** ST_* v19 bit-flag value -> DST_RESIST_* id for defender resist lookup. */
const RESIST_DST_BY_ELEMENT = new Map<number, number>([
  [0x04, DST.RESIST_FIRE],   // ST_FIRE
  [0x20, DST.RESIST_WATER],  // ST_WATER
  [0x02, DST.RESIST_ELECTRICITY], // ST_ELECTRICITY
  [0x10, DST.RESIST_WIND],   // ST_WIND
  [0x08, DST.RESIST_EARTH],  // ST_EARTH
]);

/**
 * Resolve the primary stat for a referStat (DST_STR/STA/DEX/INT) -- used by
 * GetMeleeSkillPower's RT_ATTACK branch.
 */
function statForRefer(c: Combatant, dst: number): number {
  switch (dst) {
    case 1: return c.str;  // DST_STR
    case 2: return c.dex;  // DST_DEX
    case 3: return c.int;  // DST_INT
    case 4: return c.sta;  // DST_STA
    default: return 0;
  }
}

/**
 * Skill damage result -- a `MeleeResult` plus `effectProc`, the outcome of the
 * `nProbability` secondary-effect gate. `effectProc === true` means a debuff /
 * status (stun/poison/slow) should fire; consumers ignore it until the
 * buff/status system exists (gap #1). Structurally a `MeleeResult`, so it flows
 * through the shared damage tail (`applyHit`) unchanged.
 */
export interface SkillCastResult extends MeleeResult {
  /** `nProbability` roll succeeded -- fire the skill's secondary status effect. */
  readonly effectProc: boolean;
}

/** Combatant view extended with the skill + level being cast. */
export interface SkillCastInputs {
  readonly attacker: Combatant;
  readonly defender: Combatant;
  readonly skill: SkillDefinition;
  readonly level: SkillLevel;
  readonly rng: Rng;
}

/**
 * `DoUseSkill` -> `ApplySkill` melee/magic single-target damage entry point.
 *
 * Flow:
 *   1.EXT_MELEEATK -> GetMeleeSkillPower -> standard defense subtract
 *     (reuse `calcDefense`) -> no block (NPC defender) -> final damage.
 *   2.EXT_MAGICATKSHOT -> GetMagicSkillPower -> PostCalcMagicSkill (RESIST=0,
 *     element factor applies).
 *
 * Sets `AF_MELEESKILL`/`AF_MAGICSKILL` on `atkFlags` per docs #4.
 *
 * **Crit** (`AF_CRITICAL1`, 2.3×): skill damage reuses melee `CalcDamage`
 * (docs #4 line 77), so it shares the melee crit branch -- `getCriticalProb`
 * (DEX/10 × job.fCritical + DST_CHR_CHANCECRITICAL), rolled here and applied to
 * `nATK` BEFORE defense subtract, exactly as `resolveMelee`. Applies to melee
 * AND magic skills (both flow through `CalcDamage`).
 *
 * **Effect proc** (`effectProc`): `nProbability` (level field) is the
 * secondary-effect gate -- rolled per-target in C++ `ApplySkill` (docs #4
 * line 77). It does NOT gate whether damage lands; it gates a debuff/status
 * (stun/poison/slow). We roll it and surface `effectProc` so the caller can
 * fire the status once the buff/debuff system exists. No `probability` field =
 * always proc (a pure-damage skill has no secondary effect to gate).
 * ponytail: apply the actual status effect (needs gap #1 buff/status system).
 *
 * Block omitted on NPC defender for v1 (matches `resolveMelee`'s NPC branch).
 *
 * ponytail: PVP damage vars, multi-hit, heal/buff, AoE, projectile,
 * element mastery (DST_MASTRY_*), DST_RESIST_MAGIC_RATE, GetResist (defender
 * element), DST_ADDMAGIC, dwAddSkillMin/Max from base skill.
 */
export function resolveSkillCast(input: SkillCastInputs): SkillCastResult {
  const { attacker, defender, skill, level, rng } = input;
  const ext = skill.exeTarget ?? 0;
  const isMagic = ext === 14; // EXT_MAGICATKSHOT

  let atkFlags = AF_GENERIC | (isMagic ? AF_MAGICSKILL : AF_MELEESKILL);

  const power = isMagic
    ? getMagicSkillPower(attacker, skill, level)
    : getMeleeSkillPower(attacker, skill, level);

  const lo = Math.min(power.min, power.max);
  const hi = Math.max(power.min, power.max);
  let nATK = rng.range(lo, hi + 1);
  if (nATK < 0) nATK = 0;

  // GetATKMultiplier (MoverAttack.cpp:1207) — DST_ATKPOWER_RATE (%) buff.
  // C++ CalcATK applies this to ALL attack types (melee AND skills) at
  // AttackArbiter.cpp:329, AFTER the ATK roll, BEFORE defense subtract.
  // Melee applies it inside getHitMinMax; skills must apply it here.
  // ponytail: PvP modifier + SM_* mode adjustments from GetATKMultiplier skipped.
  const atkRate = attacker.params.get(DST.ATKPOWER_RATE, 0);
  if (atkRate !== 0) {
    nATK = Math.floor(nATK * (1.0 + atkRate / 100));
  }

  // Skills never crit — C++ IsCriticalAttack() returns FALSE for skill attacks
  // (MoverAttack.cpp:800: `if (IsSkillAttack(dwAtkFlags)) return FALSE`).

  // Standard defense path. Magic uses CalcDefense too (docs #4: nDEF =
  // defender.CalcDefense), then PostCalcMagicSkill applies magic factor.
  const nDEF = calcDefense(defender);
  let nDamage: number;
  if (isMagic) {
    nDamage = postCalcMagicSkill(nATK, defender, nDEF, skill.element ?? 0);
  } else {
    nDamage = Math.max(0, nATK - nDEF);
  }

  // GetDamageMultiplier -- shared `CalcDamage` tail (docs #4): PvP 0.60 + the
  // NPC level-diff cosine falloff apply to skill damage exactly as melee. Was
  // skipped before, dropping both factors on the skill path.
  nDamage = Math.floor(nDamage * getDamageMultiplier(attacker, defender));

  // Zero damage clears the crit flag (matches melee -- no crit banner on a
  // fully-blocked/absorbed hit).
  if (nDamage <= 0) {
    nDamage = 0;
    atkFlags &= ~AF_CRITICAL1;
  }

  // Secondary-effect gate: `nProbability` roll. Absent field = always proc.
  const prob = level.probability;
  const effectProc = prob === undefined || rng.int(100) < prob;

  return { hit: true, damage: nDamage, atkFlags, effectProc };
}
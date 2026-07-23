/**
 * v15 skill damage formulas -- pure port of the `GetMeleeSkillPower` +
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
 * FIRE=5->1, WATER=7->2, ELECTRICITY=4->3, WIND=6->4, EARTH=8->5. We index by the
 * 1..5 numeric element id post-conversion.
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
  const key = `${atkElement}>${defElement}`;
  if (MAGIC_FACTOR_BEATS.has(key)) return 0.9;
  return 1.0;
}

/** Map ST_* resource element value -> 1..5 internal magic-factor index. */
const ST_TO_INTERNAL: ReadonlyMap<number, number> = new Map([
  [5, 1], // ST_FIRE
  [7, 2], // ST_WATER
  [4, 3], // ST_ELECTRICITY
  [6, 4], // ST_WIND
  [8, 5], // ST_EARTH
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
  const skillLvl = level.level ?? 1;
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
  return getMeleeSkillPower(attacker, skill, level);
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
  // nATK -= nATK * RESIST_MAGIC_RATE/100  -> v1: no-op
  let a = nATK - defenderDef;
  if (a < 0) a = 0;
  // (1 - GetResist(skillElement)) -> v1: 1.0
  const internalElem = ST_TO_INTERNAL.get(skillElement) ?? 0;
  const defInternal = ST_TO_INTERNAL.get(defender.element) ?? 0;
  const factor = internalElem > 0 ? getMagicSkillFactor(internalElem, defInternal) : 1.0;
  return Math.floor(a * factor);
}

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
 * Sets `AF_MELEESKILL`/`AF_MAGICSKILL` on `atkFlags` per docs #4. Crit is not
 * rolled here (skill crit uses its own `nProbability` -- ponytail: needs
 * `MoverAttack.cpp` crit-skill branch). Block omitted on NPC defender for v1
 * (matches `resolveMelee`'s NPC branch behavior).
 *
 * ponytail: PVP damage vars, multi-hit, heal/buff, AoE, projectile,
 * element mastery (DST_MASTRY_*), DST_RESIST_MAGIC_RATE, GetResist (defender
 * element), DST_ADDMAGIC, dwAddSkillMin/Max from base skill.
 */
export function resolveSkillCast(input: SkillCastInputs): MeleeResult {
  const { attacker, defender, skill, level, rng } = input;
  const ext = skill.exeTarget ?? 0;
  const isMagic = ext === 14; // EXT_MAGICATKSHOT

  const atkFlags = AF_GENERIC | (isMagic ? AF_MAGICSKILL : AF_MELEESKILL);

  // Hit/miss for skills uses `nProbability` (level field) -- v1: skills always
  // hit. The C++ pipeline rolls per-target in `ApplySkill`; probability gates
  // secondary effects (stun/poison), not whether damage lands.
  // ponytail: roll nProbability for hit, gate secondary effects.

  const power = isMagic
    ? getMagicSkillPower(attacker, skill, level)
    : getMeleeSkillPower(attacker, skill, level);

  const lo = Math.min(power.min, power.max);
  const hi = Math.max(power.min, power.max);
  let nATK = rng.range(lo, hi + 1);
  if (nATK < 0) nATK = 0;

  // Standard defense path. Magic uses CalcDefense too (docs #4: nDEF =
  // defender.CalcDefense), then PostCalcMagicSkill applies magic factor.
  // Lazy import via require-style to dodge the cycle with formulas.ts --
  // formulas.ts has no dep on skillFormulas, so a top-level import is fine.
  const nDEF = calcDefenseView(defender);
  let nDamage: number;
  if (isMagic) {
    nDamage = postCalcMagicSkill(nATK, defender, nDEF, skill.element ?? 0);
  } else {
    nDamage = Math.max(0, nATK - nDEF);
  }

  // Crit flag is informational for skills (no 2.3x in v1 -- skills don't use
  // the melee crit branch). ponytail: skill crit.
  void AF_CRITICAL1;

  return { hit: true, damage: nDamage, atkFlags };
}

/**
 * Local copy of `calcDefense` (NPC branch only -- players-as-defender comes
 * later). Avoids a circular import + keeps the helper pure.
 */
function calcDefenseView(defender: Combatant): number {
  if (defender.kind === 'npc') {
    return Math.floor(defender.npcArmor / 7.0) + 1;
  }
  // Player defender -- same shape as formulas.calcDefense.
  // Lazy getJobProps via dynamic import would be cyclic; defer to formulas
  // via the attacker.weapon.option factor (0 here). ponytail: share table.
  return Math.floor((0 + 0) * 2.3 + (defender.level + defender.sta / 2 + defender.dex) / 2.8 - 4 + defender.level * 2 + 0);
}

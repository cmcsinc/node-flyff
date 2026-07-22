/**
 * Zod schemas for v15 skill definitions.
 *
 * Mirrors the on-disk layout produced by the converter:
 *   - propSkill.txt  -> base {@link SkillDefinition} (static skill data)
 *   - propSkillAdd.csv -> per-level {@link SkillLevel} (scaling, cost, cooldown)
 *
 * Field names preserve the original C++/column names where possible so the
 * damage pipeline and JOIN serializer can cross-reference the C++ source.
 * Most fields are optional -- real propSkill rows leave unrelated columns as
 * the `=` inherit sentinel or `NULL_ID`; the converter normalizes those to
 * omitted/0 before emitting YAML.
 *
 * @module schemas/skill.schema
 */

import { z } from 'zod';

/** Per-level skill data (one row per `dwSkillLvl` from propSkillAdd.csv). */
export const SkillLevelSchema = z.object({
  /** Skill level (1-based, matches `dwSkillLvl`). */
  level: z.number().int().positive(),
  /** `dwAbilityMin` -- minimum base damage (PVE). */
  abilityMin: z.number().int().optional(),
  /** `dwAbilityMax` -- maximum base damage (PVE). */
  abilityMax: z.number().int().optional(),
  /** `dwAbilityMinPVP` (inherits from abilityMin via `=` rule). */
  abilityMinPvp: z.number().int().optional(),
  /** `dwAbilityMaxPVP` (inherits from abilityMax via `=` rule). */
  abilityMaxPvp: z.number().int().optional(),
  /** `nProbability` -- hit/effect chance (0-100). */
  probability: z.number().int().optional(),
  /** `nProbabilityPVP` (inherits from probability). */
  probabilityPvp: z.number().int().optional(),
  /** `dwDestParam1/2` -- DST_* targets the skill modifies (DST_HP, DST_MP, ...). */
  destParams: z.array(z.number().int()).optional(),
  /** `nAdjParamVal1/2` -- per-stat adjustment values paired with destParams. */
  adjParamVals: z.array(z.number().int()).optional(),
  /** `dwChgParamVal1/2` -- duration/charges paired with destParams. */
  chgParamVals: z.array(z.number().int()).optional(),
  /** `dwdestData1/2/3` -- generic extra data (skill-specific). */
  destData: z.array(z.number().int()).optional(),
  /** `nReqMp` -- MP cost (signed; `-1` sentinel = 0 in v1). */
  reqMp: z.number().int().optional(),
  /** `nReqFp` -- FP cost (signed; `-1` sentinel = 0 in v1). */
  reqFp: z.number().int().optional(),
  /** `dwCooldown` -- cooldown in ms (inherits base `dwSkillReady` via `=` rule). */
  cooldown: z.number().int().optional(),
  /** `dwCastingTime` -- cast bar duration in ms. */
  castingTime: z.number().int().optional(),
  /** `dwSkillRange` -- effective range / AoE radius. */
  skillRange: z.number().int().optional(),
  /** `dwSkillTime` -- buff duration in ms (0 for non-buffs). */
  skillTime: z.number().int().optional(),
  /** `nSkillCount` -- multi-hit count (signed; 1 = single hit). */
  skillCount: z.number().int().optional(),
});
export type SkillLevel = z.infer<typeof SkillLevelSchema>;

/** Base skill definition (one row from propSkill.txt). */
export const SkillDefinitionSchema = z.object({
  /** `dwID` resolved via defineSkill.h `SI_*` -> numeric. */
  id: z.number().int().positive(),
  /** Display name from propSkill.txt.txt via `szName` (IDS_PROPSKILL_*). */
  name: z.string().max(64),
  /** `szName` localization key (IDS_PROPSKILL_TXT_*). */
  name_id: z.string(),
  /** `dwItemKind1` JTYPE_* tier (0=BASE, 1=EXPERT, 2=PRO, 4=COMMON, 5=MASTER, 6=HERO). */
  tier: z.number().int().min(0).max(6),
  /** `dwItemKind2` JOB_* (defineJob.h). */
  job: z.number().int().min(0).default(0),
  /** `dwItemKind3` DIS_* discipline (defineJob.h). */
  discipline: z.number().int().min(0).default(0),
  /** `dwWeaponType` WT_* (defineAttribute.h). */
  weaponType: z.number().int().optional(),
  /** `dwHanded` HD_* (1=one-handed, 3=dual). */
  handed: z.number().int().optional(),
  /** `dwAttackRange` AR_* (1=short, 2=medium, 3=long). */
  attackRange: z.number().int().optional(),
  /** `dwReqDisLV` minimum job-dispatch level to learn. */
  reqLevel: z.number().int().min(0).default(0),
  /** `dwReSkill1`/`dwReSkillLevel1` + 2/2 -- prerequisite (skillId, level) pairs. */
  prereqs: z.array(z.object({
    skill: z.number().int(),
    level: z.number().int(),
  })).default([]),
  /** `dwSkillReadyType` SR_* (1=AFTER, 2=BEFORE). */
  cooldownType: z.number().int().optional(),
  /** `dwSkillReady` base cooldown ms -- fallback for per-level `=` cooldown. */
  baseCooldown: z.number().int().optional(),
  /** `dwExeTarget` EXT_* cast mechanic (17=MELEEATK, 14=MAGICATKSHOT, ...). */
  exeTarget: z.number().int().optional(),
  /** `dwUseChance` WUI_* targeting. */
  useChance: z.number().int().optional(),
  /** `dwSpellRegion` SRO_* AoE shape. */
  spellRegion: z.number().int().optional(),
  /** `dwSpellType` ST_* element. */
  element: z.number().int().optional(),
  /** `dwSkillType` KT_* -- 1=MP, 2=FP. */
  resourceType: z.number().int().min(0),
  /** `dwReferStat1/2` -- DST_* stats the skill scales with. */
  referStats: z.array(z.number().int()).length(2).optional(),
  /** `dwReferTarget1/2` -- RT_* apply kind (1=ATTACK, 2=TIME, 3=HEAL). */
  referTargets: z.array(z.number().int()).length(2).optional(),
  /** `dwReferValue1/2` -- per-stat scaling factors paired with referStats. */
  referValues: z.array(z.number().int()).length(2).optional(),
  /** `dwSubDefine` SA_* anchor -- per-level rows sit at `subDefine + level - 1`. */
  subDefine: z.number().int().optional(),
  /** `dwExpertMax` maximum skill level. */
  maxLevel: z.number().int().positive().default(1),
  /** `dwUseMotion` MTI_* animation id. */
  useMotion: z.number().int().optional(),
  /** `dwSfxElemental` XI_SKILL_* visual/sfx. */
  sfx: z.number().int().optional(),
  /** Per-level scaling rows (sorted by `level`). Empty for passive/non-scaling. */
  levels: z.array(SkillLevelSchema).default([]),
});
export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>;

/** One job-bucketed yml file. */
export const SkillFileSchema = z.object({
  _version: z.string(),
  _job: z.string().optional(),
  skills: z.array(SkillDefinitionSchema),
});

/** `_index.yml` -- `id -> { file, name }`. */
export const SkillIndexSchema = z.record(
  z.string().transform((v) => parseInt(v, 10)),
  z.object({
    file: z.string(),
    name: z.string(),
  }),
);

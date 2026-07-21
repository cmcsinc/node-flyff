/**
 * Zod schemas for Skill definitions.
 *
 * Validates skill data including passive and active skills.
 *
 * @module schemas/skill.schema
 */

import { z } from 'zod';

/**
 * Skill type enumeration.
 */
export const SkillTypeEnum = z.enum([
  'passive',
  'active',
  'toggle',
  'buff',
  'debuff',
  'attack',
  'heal',
]);

/**
 * Target type enumeration.
 */
export const TargetTypeEnum = z.enum([
  'self',
  'single',      // Single target
  'aoe_circle',  // Area of effect (circular)
  'aoe_cone',    // Area of effect (cone)
  'party',       // All party members
  'guild',       // All guild members
]);

/**
 * Skill level definition (per-level stats).
 */
export const SkillLevelSchema = z.object({
  /** Skill level (1-based) */
  level: z.number().int().positive(),

  /** MP cost at this level */
  mp_cost: z.number().int().min(0).optional(),

  /** FP cost at this level */
  fp_cost: z.number().int().min(0).optional(),

  /** Cast time in seconds */
  cast_time: z.number().nonnegative().optional(),

  /** Cooldown in seconds */
  cooldown: z.number().nonnegative().optional(),

  /** Duration in seconds (for buffs/debuffs) */
  duration: z.number().nonnegative().optional(),

  /** Range in meters */
  range: z.number().nonnegative().optional(),

  /** AOE radius in meters */
  aoe_radius: z.number().nonnegative().optional(),

  /** Damage per hit */
  damage: z.number().int().optional(),

  /** Damage multiplier (e.g., 2.5 = 250% damage) */
  damage_multiplier: z.number().optional(),

  /** Attack power bonus */
  attack_bonus: z.number().int().optional(),

  /** Defense bonus */
  defense_bonus: z.number().int().optional(),

  /** HP regeneration */
  hp_regen: z.number().int().optional(),

  /** MP regeneration */
  mp_regen: z.number().int().optional(),

  /** Dodge rate bonus */
  dodge_bonus: z.number().int().optional(),

  /** Attack rate bonus */
  attack_rate_bonus: z.number().int().optional(),

  /** Movement speed bonus */
  speed_bonus: z.number().optional(),

  /** Critical hit chance bonus */
  crit_bonus: z.number().optional(),

  /** Custom effect data (extensible) */
  custom: z.record(z.any()).optional(),
});

/**
 * Skill definition schema.
 */
export const SkillDefinitionSchema = z.object({
  /** Unique skill ID */
  id: z.number().int().positive(),

  /** Display name */
  name: z.string().max(64),

  /** Localization key */
  name_id: z.string().refine((s) => s.startsWith('SKILL_') || s.startsWith('IDS_PROPSKILL_'), {
    message: "must start with 'SKILL_' or 'IDS_PROPSKILL_'",
  }),

  /** Description localization key */
  name_desc_id: z.string().startsWith('SKILL_').optional(),

  /** Icon filename */
  icon: z.string().endsWith('.dds').optional(),

  /** Skill type */
  type: SkillTypeEnum,

  /** Target type */
  target_type: TargetTypeEnum.optional(),

  /** Required level to learn */
  level_req: z.number().int().min(1).default(1),

  /** Required job class */
  job_req: z.enum([
    'all',
    'vagrant',
    'mercenary',
    'acrobat',
    'assist',
    'magician',
    'blade',
    'knight',
    'jester',
    'billposter',
    'ranger',
    'elementor',
    'psykeeper',
  ]).default('all'),

  /** Skill points required */
  skill_points: z.number().int().min(0).default(1),

  /** Max skill level */
  max_level: z.number().int().positive().default(10),

  /** Prerequisite skill IDs */
  prerequisites: z.array(z.object({
    skill_id: z.number().int().positive(),
    level: z.number().int().positive(),
  })).optional(),

  /** Per-level stat scaling */
  levels: z.array(SkillLevelSchema).min(1),
});

/**
 * Inferred TypeScript type for skill definition.
 */
export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>;

/**
 * Skill file wrapper schema.
 */
export const SkillFileSchema = z.object({
  _version: z.string(),
  _job: z.string().optional(),
  skills: z.array(SkillDefinitionSchema),
});

/**
 * Skill index file schema (_index.yml).
 */
export const SkillIndexSchema = z.record(
  z.string().transform((v) => parseInt(v, 10)),
  z.object({
    file: z.string(),
    name: z.string(),
  })
);

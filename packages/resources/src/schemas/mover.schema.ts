/**
 * Zod schemas for Mover definitions.
 *
 * Movers include: NPCs, monsters, pets, and player base stats.
 *
 * @module schemas/mover.schema
 */

import { z } from 'zod';

/**
 * AI behavior types.
 */
export const AiTypeEnum = z.enum([
  'aggressive',     // Attacks on sight
  'passive',        // Never attacks first
  'passive_aggro',  // Passive but retaliates
  'guard',          // Guards a specific area
  'boss',           // Boss AI behavior
]);

/**
 * Mover type enumeration.
 */
export const MoverTypeEnum = z.enum([
  'monster',
  'npc',
  'pet',
  'player',
  'boss',
  'giant',
  'raid',
]);

/**
 * Single mover definition schema.
 */
export const MoverDefinitionSchema = z.object({
  /** Unique mover ID */
  id: z.number().int().positive(),

  /** Display name */
  name: z.string().max(64),

  /** Localization key */
  name_id: z.string().refine((s) => s.startsWith('MOVER_') || s.startsWith('NPC_'), {
    message: "must start with 'MOVER_' or 'NPC_'",
  }),

  /** 3D model filename */
  model: z.string().endsWith('.o3d'),

  /** Model scale (1.0 = normal size) */
  scale: z.number().positive().default(1.0),

  /** Mover type */
  type: MoverTypeEnum.optional(),

  // Stats
  /** Level */
  level: z.number().int().min(1).max(255),

  /** Hit points */
  hp: z.number().int().positive(),

  /** Mana points */
  mp: z.number().int().min(0).default(0),

  /** FP (Fatigue Points) */
  fp: z.number().int().min(0).default(0),

  /** Attack power */
  attack: z.number().int().min(0),

  /** Defense rating */
  defense: z.number().int().min(0),

  /** Magic attack */
  magic_attack: z.number().int().min(0).optional(),

  /** Magic defense */
  magic_defense: z.number().int().min(0).optional(),

  /** Attack rate (accuracy) */
  attack_rate: z.number().int().min(0),

  /** Dodge rate */
  dodge_rate: z.number().int().min(0),

  /** Movement speed multiplier (0 = stationary for NPCs) */
  speed: z.number().nonnegative().default(1.0),

  /** Attack speed multiplier (0 = no attacks for NPCs) */
  attack_speed: z.number().nonnegative().default(1.0),

  // AI
  /** AI behavior type */
  ai_type: AiTypeEnum.optional(),

  /** Agro detection range */
  agro_range: z.number().nonnegative().optional(),

  /** Max chase distance */
  chase_range: z.number().nonnegative().optional(),

  /** Attack range (melee = ~2.5) */
  attack_range: z.number().nonnegative().optional(),

  // Rewards (for monsters)
  /** Experience points on kill */
  exp: z.number().int().min(0).optional(),

  /** Penya (gold) drop */
  penya: z.number().int().min(0).optional(),

  /** Drop rate multiplier */
  drop_rate: z.number().min(0).optional(),

  // Spawning
  /** Respawn delay in milliseconds */
  spawn_delay: z.number().int().positive().optional(),

  /** Max instances per spawn point */
  spawn_count: z.number().int().positive().default(1).optional(),

  // Flags
  /** Can fly */
  flyable: z.boolean().default(false),

  /** Is a boss monster */
  boss: z.boolean().default(false),

  /** Is a giant (rare spawn) */
  giant: z.boolean().default(false),

  /** Is a raid boss */
  raid: z.boolean().default(false),

  /** Can be attacked */
  attackable: z.boolean().default(true),

  // NPC-specific
  /** NPC functions (for NPCs only) */
  functions: z.array(z.object({
    type: z.enum(['shop', 'dialogue', 'teleport', 'bank', 'guild', 'warehouse']),
    shop_id: z.string().optional(),
    dialogue_id: z.string().optional(),
    destinations: z.array(z.string()).optional(),
  })).optional(),

  // Giant/boss specific
  /** Enrage HP percentage threshold */
  enrage_hp_percent: z.number().int().min(0).max(100).optional(),
});

/**
 * Inferred TypeScript type for mover definition.
 */
export type MoverDefinition = z.infer<typeof MoverDefinitionSchema>;

/**
 * Mover file wrapper schema.
 */
export const MoverFileSchema = z.object({
  _version: z.string(),
  movers: z.array(MoverDefinitionSchema),
});

/**
 * Mover index file schema (_index.yml).
 */
export const MoverIndexSchema = z.record(
  z.string().transform((v) => parseInt(v, 10)),
  z.object({
    file: z.string(),
    name: z.string(),
  })
);

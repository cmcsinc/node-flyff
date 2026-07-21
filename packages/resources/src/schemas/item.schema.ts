/**
 * Zod schemas for Item definitions.
 *
 * Validates YAML structure for items in resources/data/items/*.yml
 *
 * @module schemas/item.schema
 */

import { z } from 'zod';

/**
 * Item kind/category enumeration.
 */
export const ItemKindEnum = z.enum([
  'weapon',
  'armor',
  'shield',
  'helm',
  'glove',
  'boot',
  'suit',
  'consumable',
  'material',
  'quest',
  'jewelry',
  'necklace',
  'ring',
  'earring',
  'cloak',
  'cash',
]);

/**
 * Job class enumeration for requirements.
 */
export const JobEnum = z.enum([
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
  'ringmaster',  // Added: Support class evolution
  'ranger',
  'elementor',
  'psykeeper',
]);

/**
 * Rarity tier enumeration.
 */
export const RarityEnum = z.enum(['common', 'uncommon', 'rare', 'legendary', 'ancient']);

/**
 * Single item definition schema.
 */
export const ItemDefinitionSchema = z.object({
  /** Unique item ID */
  id: z.number().int().positive(),

  /** Display name */
  name: z.string().max(64),

  /** Localization key — symbolic (`ITEM_*`) or raw Flyff text ID (`IDS_PROPITEM_*`) */
  name_id: z.string().refine((s) => s.startsWith('ITEM_') || s.startsWith('IDS_PROPITEM_'), {
    message: "must start with 'ITEM_' or 'IDS_PROPITEM_'",
  }),

  /** Icon filename (optional) */
  icon: z.string().endsWith('.dds').optional(),

  /** 3D model filename (optional) */
  model: z.string().endsWith('.o3d').optional(),

  // Stats
  /** Attack power (weapons only) — average of min/max for back-compat */
  attack: z.number().int().min(0).optional(),

  /** Raw min attack (propItem dwAbilityMin) — weapons/armor ability floor */
  attack_min: z.number().int().min(0).optional(),

  /** Raw max attack (propItem dwAbilityMax) — weapons only */
  attack_max: z.number().int().min(0).optional(),

  /** Raw attack speed (propItem dwAttackSpeed) — fractional multiplier, feeds combat atkSpeed table */
  attack_speed: z.number().min(0).optional(),

  /** Defense rating (armor only) */
  defense: z.number().int().min(0).optional(),

  /** Magic defense (armor only) */
  magic_defense: z.number().int().min(0).optional(),

  /** Attack rate multiplier */
  attack_rate: z.number().min(0).optional(),

  /** Defense rate multiplier */
  defense_rate: z.number().min(0).optional(),

  // Consumable-specific
  /** HP restore amount (consumables) */
  hp_restore: z.number().int().min(0).optional(),

  /** FP restore amount (consumables) */
  fp_restore: z.number().int().min(0).optional(),

  /** MP restore amount (consumables) */
  mp_restore: z.number().int().min(0).optional(),

  /** Attack bonus (buff consumables) */
  attack_bonus: z.number().int().min(0).optional(),

  /** Speed bonus (buff consumables) */
  speed_bonus: z.number().int().min(0).optional(),

  /** Buff duration in seconds (buff consumables) */
  duration: z.number().int().positive().optional(),

  /** Item durability (max uses) */
  durability: z.number().int().positive().optional(),

  /** Weight in inventory */
  weight: z.number().int().min(0).default(1),

  /** Max stack per slot (propItem dwPackMax) — 1 = non-stacking. */
  stack_size: z.number().int().min(1).default(1),

  /** Equip slot / parts index (propItem dwParts, PARTS_*) — undefined = not equippable. */
  equip_slot: z.number().int().min(0).optional(),

  /** Weapon type (propItem dwWeaponType, WT_*) — swords/axes/wands/bows/etc. */
  weapon_type: z.number().int().min(0).optional(),

  /** Raw item kind 2 (propItem dwItemKind2, IK2_*) — potion/food/buff/skill/warp/text routing. */
  item_kind2: z.string().optional(),

  /** Raw item kind 3 (propItem dwItemKind3, IK3_*) — fine category. */
  item_kind3: z.string().optional(),

  // Requirements
  /** Required level to equip */
  level_req: z.number().int().min(1).default(1),

  /** Required job classes */
  job_req: z.array(JobEnum).optional(),

  /** Required gender (if applicable) */
  gender_req: z.enum(['male', 'female', 'both']).optional(),

  // Economy
  /** Purchase price from NPCs */
  price: z.number().int().min(0).default(0),

  /** Sell price to NPCs */
  sell_price: z.number().int().min(0).default(0),

  // Flags
  /** Can be traded between players */
  tradeable: z.boolean().default(true),

  /** Can be dropped on the ground */
  dropable: z.boolean().default(true),

  /** Can be destroyed */
  destroyable: z.boolean().default(true),

  /** Can be stored in bank */
  bankable: z.boolean().default(true),

  /** Can be sold to shops */
  sellable: z.boolean().default(true),

  // Extensible fields
  /** Rarity tier */
  rarity: RarityEnum.optional(),

  /** Two-handed weapon flag */
  two_handed: z.boolean().optional(),

  /** Part of an item set */
  set_id: z.number().int().positive().optional(),

  /** Element attribute */
  element: z.enum(['fire', 'water', 'electric', 'wind', 'earth']).optional(),

  /** Element level */
  element_level: z.number().int().min(0).max(4).optional(),
});

/**
 * Inferred TypeScript type for item definition.
 */
export type ItemDefinition = z.infer<typeof ItemDefinitionSchema>;

/**
 * Item file wrapper schema (validates the whole file structure).
 */
export const ItemFileSchema = z.object({
  /** Schema version */
  _version: z.string(),

  /** Item category */
  _kind: ItemKindEnum,

  /** Array of items */
  items: z.array(ItemDefinitionSchema),
});

/**
 * Item index file schema (_index.yml).
 */
export const ItemIndexSchema = z.record(
  z.string().transform((v) => parseInt(v, 10)),
  z.object({
    file: z.string(),
    name: z.string(),
  })
);

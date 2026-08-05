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
  /** Catch-all for kinds with no dedicated bucket (IK1_EFFECT, IK1_RIDE, IK1_HOUSING, ...). */
  'misc',
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

  /** Localization key -- symbolic (`ITEM_*`) or raw Flyff text ID (`IDS_PROPITEM_*`) */
  name_id: z.string().refine((s) => s.startsWith('ITEM_') || s.startsWith('IDS_PROPITEM_'), {
    message: "must start with 'ITEM_' or 'IDS_PROPITEM_'",
  }),

  /** Icon filename (optional). Case-insensitive extension -- propItem spells both `.dds` and `.DDS`. */
  icon: z
    .string()
    .refine((s) => /\.dds$/i.test(s), { message: 'must end with .dds' })
    .optional(),

  /** 3D model filename (optional) */
  model: z.string().endsWith('.o3d').optional(),

  // Stats
  /** Attack power (weapons only) -- average of min/max for back-compat */
  attack: z.number().int().min(0).optional(),

  /** Raw min attack (propItem dwAbilityMin) -- weapons/armor ability floor */
  attack_min: z.number().int().min(0).optional(),

  /** Raw max attack (propItem dwAbilityMax) -- weapons only */
  attack_max: z.number().int().min(0).optional(),

  /** Raw attack speed (propItem dwAttackSpeed) -- fractional multiplier, feeds combat atkSpeed table */
  attack_speed: z.number().min(0).optional(),

  /** Defense rating (armor only) -- propItem dwAbilityMin floor */
  defense: z.number().int().min(0).optional(),

  /** Defense ceiling (armor only) -- propItem dwAbilityMax. When set, combat
   *  randomizes defense between `defense` and `defense_max` per hit. */
  defense_max: z.number().int().min(0).optional(),

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

  /**
   * Cooldown duration in ms (propItem `dwSkillReady` = `ItemProp::GetCoolTime`).
   * When > 0, using this item locks its cooldown group (food/pill/skill) until
   * elapsed -- `CooltimeMgr.h` / `MoverSkill.cpp:1335`. Zero/undefined = none.
   */
  cooldown_ms: z.number().int().min(0).optional(),

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

  /** Max stack per slot (propItem dwPackMax) -- 1 = non-stacking. */
  stack_size: z.number().int().min(1).default(1),

  /** Equip slot / parts index (propItem dwParts, PARTS_*) -- undefined = not equippable. */
  equip_slot: z.number().int().min(0).optional(),

  /** Weapon type (propItem dwWeaponType, WT_*) -- swords/axes/wands/bows/etc. */
  weapon_type: z.number().int().min(0).optional(),

  /** Raw item kind 2 (propItem dwItemKind2, IK2_*) -- potion/food/buff/skill/warp/text routing. */
  item_kind2: z.string().optional(),

  /** Raw item kind 3 (propItem dwItemKind3, IK3_*) -- fine category. */
  item_kind3: z.string().optional(),

  // Blinkwing (teleport scroll) -- IK2_BLINKWING only. v19 reuses four unrelated
  // weapon columns as the destination (`MoverSkill.cpp:2049-2057`):
  //   dwWeaponType     -> world id (WI_*)
  //   dwItemAtkOrder1..4 -> x, y, z, angle
  // Present only on `IK3_BLINKWING` (fixed destination). `IK3_TOWNBLINKWING`
  // resolves its target at runtime from the world's revival point and its own
  // columns hold `=`-inherited garbage, so the converter omits them there.
  /** Destination world id (propItem `dwWeaponType` as `WI_*`). */
  blink_world: z.number().int().min(1).optional(),

  /** Destination position (propItem `dwItemAtkOrder1..3`). y=0 means ground-snap. */
  blink_pos: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional(),

  /** Facing on arrival, degrees (propItem `dwItemAtkOrder4`). */
  blink_angle: z.number().optional(),

  /**
   * Channel time in ms before the teleport fires (propItem `dwSkillReadyType`).
   * `CMover::IsItemRedyTime` (`Mover.cpp:8795`) arms `m_nReadyTime` on the first
   * DOUSEITEM and only teleports on the second pass. 10 s for blinkwings,
   * 300 s for the Return scroll. Zero/undefined = instant.
   */
  ready_ms: z.number().int().min(0).optional(),

  /**
   * Minimum level to *use* (propItem `dwLimitLevel1`). Distinct from
   * `level_req`, which gates equipping. `MoverSkill.cpp:1995` refuses with
   * `TID_GAME_USINGNOTLEVEL`.
   */
  use_level: z.number().int().min(1).optional(),

  /**
   * Linked mover id (propItem `dwLinkKind`, an `MI_*` from defineObj.h resolved
   * to its numeric index). On an `IK3_PET` looter item this is the mover the
   * server spawns on summon -- `CreateMover( GetWorld(), pProp->dwLinkKind, ... )`
   * (`MoverSkill.cpp:4392`). Only emitted for `IK3_PET`: propItem's `=` inherit
   * rule would otherwise leak the previous row's link onto unrelated items.
   */
  link_kind: z.number().int().positive().optional(),

  // Flight (ride items only -- IK1_RIDE, dwParts == PARTS_RIDE 13).
  // Columns 292-298 of `Spec_Item.txt`, parsed in this order by C++
  // `ProjectCmn.cpp:475-481`. Present only on boards/brooms/wings; every other
  // item omits the whole block.
  /**
   * Base flight speed (propItem `fFlightSpeed`, e.g. `0.0023`). Two roles: the
   * client derives `m_fAccPower = fFlightSpeed * 0.75`
   * (`ActionMoverState2.cpp:482`), and the client echoes this exact float back on
   * the DOEQUIP that mounts the item so the server can reject a tampered client
   * (`__HACK_1023`, `DPSrvr.cpp:793-807`). Float -- do NOT round.
   */
  flight_speed: z.number().optional(),

  /** Left/right turn rate (propItem `fFlightLRAngle`). Client-side physics only. */
  flight_lr_angle: z.number().optional(),

  /** Pitch rate (propItem `fFlightTBAngle`). Client-side physics only. */
  flight_tb_angle: z.number().optional(),

  /**
   * Minimum `GetFlightLv()` to mount (propItem `dwFlightLimit`). Every ride item
   * in v19 ships `1`, and flight level is derived as `level >= 20 ? 1 : 0`
   * (`Mover.h:549`) -- so in practice this is a level-20 gate. `NULL_ID` in the
   * source is normalized to `1` by C++ (`MoverEquip.cpp:1500-1502`).
   */
  flight_limit: z.number().int().min(0).optional(),

  /**
   * Flight-fuel capacity (propItem `dwFFuelReMax`). Seeded into `m_nFuel` on
   * mount. Note v19 NEVER decrements flight fuel -- the only decrement site is
   * commented out (`ActionMoverMsg2.cpp:262`), so this is a display capacity.
   */
  fuel_max: z.number().int().min(0).optional(),

  /** Turbo-fuel capacity in seconds (propItem `dwAFuelReMax`). ponytail: turbo unported. */
  acc_fuel_max: z.number().int().min(0).optional(),

  /** Refuel amount granted by an `IK2_AIRFUEL` item (propItem `dwFuelRe`). ponytail. */
  fuel_refill: z.number().int().min(0).optional(),

  /** Flat hit-rate bonus % (propItem `nAdjHitRate`) -- jewelry DST_ADJ_HITRATE. */
  hit_rate: z.number().int().optional(),

  /** Evasion/parry bonus (propItem `dwParry`) -- jewelry DST_PARRY. */
  parry: z.number().int().optional(),

  /**
   * DST destination-parameter effects from the propItem `dwDestParam{1,2,3}` /
   * `nAdjParamVal{1,2,3}` / `dwChgParamVal{1,2,3}` triplets. Each entry applies
   * (equip) / removes (unequip) one adjustment on the wearer's `ParamModel`
   * (C++ `SetDestParam` per item, `MoverParam.cpp:2221`). How rings/earrings/
   * sets carry +STR/+STA/+DEF/+HP_MAX etc -- there are no dedicated stat columns.
   * `dst` is a `DST_*` numeric id; `adj` additive; `chg` optional override.
   */
  effects: z.array(z.object({
    dst: z.number().int(),
    adj: z.number().int(),
    chg: z.number().int().optional(),
  })).default([]),

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

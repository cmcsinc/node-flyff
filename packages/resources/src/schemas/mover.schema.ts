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

  /** Symbolic `MI_*` name from defineObj.h (e.g. `MI_MAFL_BOBOKU`). Links mover -> dialog prefix. */
  key: z.string().optional(),

  /** Display name */
  name: z.string().max(64),

  /** Localization key -- symbolic (`MOVER_*`/`NPC_*`) or raw Flyff text ID (`IDS_PROPMOVER_*`) */
  name_id: z.string().refine(
    (s) => s.startsWith('MOVER_') || s.startsWith('NPC_') || s.startsWith('IDS_PROPMOVER_'),
    { message: "must start with 'MOVER_', 'NPC_', or 'IDS_PROPMOVER_'" },
  ),

  /** 3D model filename (server-side reference; client resolves via dwObjIndex). Optional -- real propMover has none. */
  model: z.string().endsWith('.o3d').optional(),

  /**
   * Numeric model index sent on the wire as ADD_OBJ `dwObjIndex` /
   * CObj `m_dwIndex` -- a `MI_*` value from `resource/defineObj.h`
   * (e.g. MI_MALE=11, MI_FEMALE=12, MI_AIBATT1=20). The client loads the
   * mover's mesh + motions from propMover via this index. Required -- without
   * it the client cannot resolve the model (`CreateObj` -> `SetIndex`).
   */
  dwObjIndex: z.number().int().nonnegative(),

  /** Model scale (1.0 = normal size) */
  scale: z.number().positive().default(1.0),

  /** Mover type */
  type: MoverTypeEnum.optional(),

  /**
   * Outfit for human-type NPCs -- mirrors C++ `character.inc` `SetFigure` +
   * `SetEquip` (parsed at `_Common/Project.cpp:2928-2968`). Serialized in the
   * NPC branch of `CMover::Serialize` (`ObjSerializeOpt.cpp:319-352`).
   * Omit for monsters / model-only NPCs (IsEquipableNPC() == FALSE -> empty
   * parts array, uSize=0).
   */
  outfit: z.object({
    /** `m_szCharacterKey` -- e.g. "MaDa_Homeit". DWORD-len-prefixed on the wire, max 31 chars. */
    characterKey: z.string().min(1).max(31),
    /** `m_dwHairMesh` (u_char) -- SetFigure arg 2. */
    hairMesh: z.number().int().min(0).max(255),
    /** `m_dwHairColor` (DWORD) -- SetFigure arg 3 (ARGB, e.g. 0xff0000ff). */
    hairColor: z.number().int().nonnegative(),
    /** `m_dwHeadMesh` (u_char) -- SetFigure arg 4. */
    headMesh: z.number().int().min(0).max(255),
    /**
     * Equipped parts -- mirrors C++ `m_Inventory.GetEquip(uParts)` iteration.
     * Each entry is `{ uParts:BYTE slot, m_dwItemId:u_short }` on the wire.
     * `itemId` is the propItem id (low 16 bits; e.g. II_ARM_F_RIN_SUIT06=1029).
     */
    equip: z.array(z.object({
      parts: z.number().int().min(0).max(255),
      itemId: z.number().int().min(0).max(0xFFFF),
    })).default([]),
  }).optional(),

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

  /**
   * Re-attack delay (ms) -- propMover.txt `dwReAttackDelay` (column 35). Time
   * between consecutive monster swings. Distinct from `attack_speed` (col 34)
   * which is the attack animation speed multiplier.
   */
  re_attack_delay: z.number().int().nonnegative().default(0).optional(),

  // AI -- flee/healer (propMoverEx.inc)
  /**
   * Flee HP % -- `SetRunAway(HP%)` in propMoverEx.inc. When HP drops to/below
   * this % of max, the monster drops target and runs away. 0/absent = never flees.
   */
  fleeHpPct: z.number().int().min(0).max(100).default(0).optional(),
  /**
   * Runaway duration (ms) -- `m_dwRunawayDelay` in propMoverEx.inc.
   * How long the monster flees before returning home.
   */
  runawayDelay: z.number().int().nonnegative().default(1000).optional(),
  /**
   * Self-heal HP % -- `Recovery` block in propMoverEx.inc. When HP drops
   * to/below this % of max, the monster heals itself. 0/absent = never heals.
   */
  healHpPct: z.number().int().min(0).max(100).default(0).optional(),
  /**
   * Self-heal amount as % of max HP -- `m_nRecvCondHow` from Recovery block.
   * Per-tick heal = floor(maxHP * healPct / 100).
   */
  healPct: z.number().int().min(0).max(100).default(0).optional(),

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

  /**
   * Town guard -- `RANK_GUARD` in propMover.txt `dwClass` (e.g. MI_GUARDIAN,
   * MI_MAFL_PATROL). PK-gated: only chaotic/player-killer attackers may target
   * it. Mirrors C++ `CMover::IsAttackAbleNPC` (Mover.cpp:6572).
   */
  guard: z.boolean().default(false),

  /**
   * Aggressiveness -- C++ `m_dwBelligerence` from propMover.txt
   * (`defineAttribute.h:203-215`). The client's attack cursor is gated by
   * `CMover::IsAttackAbleNPC` (Mover.cpp:6572): `BELLI_PEACEFUL` (1) suppresses
   * it, so peaceful town NPCs must send their real value rather than 0.
   * Values: PEACEFUL=1, CAUTIOUSATTACK=2, ACTIVEATTACK=3, ALLIANCE=4,
   * ACTIVEATTACK_MELEE2X=5, ACTIVEATTACK_MELEE=6, ACTIVEATTACK_RANGE=7,
   * CAUTIOUSATTACK_MELEE2X=8, CAUTIOUSATTACK_MELEE=9, CAUTIOUSATTACK_RANGE=10,
   * MELEE2X=11, MELEE=12, RANGE=13. 0 = unspecified (legacy default).
   */
  belligerence: z.number().int().min(0).max(13).default(0),

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

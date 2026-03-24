/**
 * Zod schemas for Zone/World definitions.
 *
 * Validates zone data including spawns, NPCs, portals, and regions.
 *
 * @module schemas/zone.schema
 */

import { z } from 'zod';

/**
 * 3D position vector.
 */
export const Vector3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

/**
 * Axis-aligned bounding box.
 */
export const BoundsSchema = z.object({
  min: Vector3Schema,
  max: Vector3Schema,
});

/**
 * Portal definition (teleport between zones).
 */
export const PortalSchema = z.object({
  /** Unique portal ID within the zone */
  id: z.number().int().positive(),

  /** Portal display name */
  name: z.string(),

  /** Portal position */
  position: Vector3Schema,

  /** Interaction radius */
  radius: z.number().positive(),

  /** Target destination */
  target: z.object({
    /** Target zone ID */
    zone: z.string(),
    /** Target position */
    position: Vector3Schema,
  }),
});

/**
 * Spawn point definition.
 */
export const SpawnSchema = z.object({
  /** Unique spawn ID within the zone */
  id: z.number().int().positive(),

  /** Mover ID to spawn (from movers/ index) */
  mover_id: z.number().int().positive(),

  /** Spawn position */
  position: Vector3Schema,

  /** Random spawn radius (0 = exact position) */
  radius: z.number().nonnegative().default(0),

  /** Number of instances to spawn */
  count: z.number().int().positive(),

  /** Respawn delay in milliseconds */
  delay: z.number().int().positive(),
});

/**
 * NPC function definition.
 */
export const NpcFunctionSchema = z.object({
  /** Function type */
  type: z.enum(['shop', 'dialogue', 'teleport', 'bank', 'guild', 'warehouse', 'collect']),

  /** Shop ID (if type = shop) */
  shop_id: z.string().optional(),

  /** Dialogue ID (if type = dialogue) */
  dialogue_id: z.string().optional(),

  /** Destination zones (if type = teleport) */
  destinations: z.array(z.string()).optional(),
});

/**
 * NPC definition in a zone.
 */
export const NpcSchema = z.object({
  /** Unique NPC ID within the zone */
  id: z.number().int().positive(),

  /** Mover ID (from movers/ index) */
  mover_id: z.number().int().positive(),

  /** NPC position */
  position: Vector3Schema,

  /** Rotation angle in radians (0-2π) */
  angle: z.number().min(0).max(2 * Math.PI),

  /** Available NPC functions */
  functions: z.array(NpcFunctionSchema),
});

/**
 * Region/sub-zone type.
 */
export const RegionTypeEnum = z.enum([
  'safe',        // No PvP, no mob aggro
  'pvp',         // PvP enabled
  'pvp_party',   // Party PvP
  'pvp_guild',   // Guild war
  'dungeon',     // Instance dungeon
  'guild_war',   // Guild war siege
  'boss',        // Boss arena
]);

/**
 * Region/sub-zone definition.
 */
export const RegionSchema = z.object({
  /** Unique region ID within the zone */
  id: z.number().int().positive(),

  /** Region display name */
  name: z.string(),

  /** Region type */
  type: RegionTypeEnum,

  /** Region boundaries */
  bounds: BoundsSchema,

  /** Entry requirements */
  requirements: z.object({
    /** Minimum level */
    level_min: z.number().int().optional(),

    /** Maximum level */
    level_max: z.number().int().optional(),

    /** Required quest ID */
    quest_id: z.number().int().optional(),

    /** Required item */
    item_req: z.object({
      id: z.number().int().positive(),
      count: z.number().int().positive(),
    }).optional(),
  }).optional(),
});

/**
 * Weather type.
 */
export const WeatherTypeEnum = z.enum([
  'sunny',
  'rain',
  'snow',
  'fog',
  'thunder',
]);

/**
 * Weather variation.
 */
export const WeatherVariationSchema = z.object({
  /** Weather type */
  type: WeatherTypeEnum,

  /** Chance (0-1) */
  chance: z.number().min(0).max(1),

  /** Duration in seconds */
  duration: z.number().int().positive(),
});

/**
 * Revival point definition.
 */
export const RevivalSchema = z.object({
  /** Revival position */
  position: Vector3Schema,

  /** Revival radius */
  radius: z.number().positive(),
});

/**
 * Full zone definition schema.
 */
export const ZoneDefinitionSchema = z.object({
  /** Schema version */
  _version: z.string(),

  /** Zone string ID (e.g., "flaris") */
  _id: z.string(),

  /** Zone numeric ID (for packet protocol) */
  _id_numeric: z.number().int().positive(),

  /** Zone display name */
  name: z.string(),

  /** Localization key */
  name_id: z.string().startsWith('ZONE_'),

  /** Parent world ID */
  world_id: z.string(),

  /** Zone boundaries */
  bounds: BoundsSchema,

  /** Default revival point */
  revival: RevivalSchema,

  /** Portals to other zones */
  portals: z.array(PortalSchema).default([]),

  /** Monster spawn points */
  spawns: z.array(SpawnSchema).default([]),

  /** NPCs */
  npcs: z.array(NpcSchema).default([]),

  /** Regions/sub-zones */
  regions: z.array(RegionSchema).default([]),

  /** Weather settings */
  weather: z.object({
    /** Default weather */
    default: WeatherTypeEnum,

    /** Weather variations */
    variations: z.array(WeatherVariationSchema).optional(),
  }).optional(),
});

/**
 * Inferred TypeScript type for zone definition.
 */
export type ZoneDefinition = z.infer<typeof ZoneDefinitionSchema>;

/**
 * Zone index file schema (_index.yml).
 */
export const ZoneIndexSchema = z.record(
  z.string(),
  z.object({
    file: z.string(),
    name: z.string(),
  })
);

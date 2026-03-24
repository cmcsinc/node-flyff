/**
 * Flyff object type identifiers.
 *
 * These values correspond to the `OT_*` constants in the original C++ source
 * and are used to distinguish game world object categories.
 *
 * @module constants/objectTypes
 */

// ---------------------------------------------------------------------------
// ObjectType table
// ---------------------------------------------------------------------------

/**
 * Frozen map of all game world object type identifiers.
 */
export const ObjectType = Object.freeze({
  /** Mover — players, monsters, NPCs that can physically move. */
  MOVER:  0,
  /** Item — a dropped item on the ground. */
  ITEM:   1,
  /** Ctrl — interactive control objects (portals, triggers). */
  CTRL:   2,
  /** Region — trigger region / area boundary. */
  REGION: 3,
  /** Path — pathing waypoint node. */
  PATH:   4,
  /** Ship — rideable ship object. */
  SHIP:   5,
} as const);

/** Union type of all valid ObjectType values. */
export type ObjectTypeValue = typeof ObjectType[keyof typeof ObjectType];

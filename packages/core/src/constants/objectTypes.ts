/**
 * Flyff object type identifiers -- the `OT_*` enum from the C++ source.
 *
 * Sequential from 0, proven by the filter array indexed by `dwType` in
 * `_Common/World3D.cpp:23` (ObjTypeToObjFilter) and the `m_apObject[nType]`
 * indexing in `_Common/lod.cpp:1544-1547`. Written into the ADD_OBJ snapshot
 * at `WORLDSERVER/User.cpp:669` as `(BYTE)pCtrl->GetType()`.
 *
 * @module constants/objectTypes
 */

// ---------------------------------------------------------------------------
// ObjectType table
// ---------------------------------------------------------------------------

/**
 * Frozen map of all game world object type identifiers (C++ `OT_*` enum).
 */
export const ObjectType = Object.freeze({
  /** OT_OBJ -- static prop / scenery. */
  OBJ:    0,
  /** OT_ANI -- animated scenery. */
  ANI:    1,
  /** OT_CTRL -- interactive control (portal, trigger). */
  CTRL:   2,
  /** OT_SFX -- visual effect object. */
  SFX:    3,
  /** OT_ITEM -- a dropped item on the ground. */
  ITEM:   4,
  /** OT_MOVER -- players, monsters, NPCs that can physically move. */
  MOVER:  5,
  /** OT_REGION -- trigger region / area boundary. */
  REGION: 6,
  /** OT_SHIP -- rideable ship object. */
  SHIP:   7,
} as const);

/** Union type of all valid ObjectType values. */
export type ObjectTypeValue = typeof ObjectType[keyof typeof ObjectType];

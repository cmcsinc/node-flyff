/**
 * Town safe-zone predicate — shared by spawn exclusion and AI combat immunity.
 *
 * Towns (Flaris, …) sit on a zone's `revival.position`. Within
 * {@link TOWN_EXCLUSION_RADIUS} of that point the area is peaceful: monsters
 * neither spawn there (`SpawnManager`) nor aggro/damage players who enter
 * (`AISystem`). One constant, one definition of "town".
 *
 * 2D (x/z plane) Euclidean — y is vertical and irrelevant for town bounds.
 * Matches the vanilla intent (peaceful regions around lodestars) without
 * porting the full `GetNearRevivalPos` multi-point table (ponytail).
 *
 * @module combat/safeZone
 */

import type { Vec3 } from '../entities/player.js';

/** Radius (world units, x/z plane) around a zone's revival point kept peaceful. */
export const TOWN_EXCLUSION_RADIUS = 1000;

/**
 * True if `pos` is within the town safe-zone of `revivalPos`.
 * `revivalPos` undefined → false (no revival data for the zone → not safe).
 */
export function isInSafeZone(pos: Vec3, revivalPos?: Vec3): boolean {
  if (!revivalPos) return false;
  return Math.hypot(pos.x - revivalPos.x, pos.z - revivalPos.z) < TOWN_EXCLUSION_RADIUS;
}

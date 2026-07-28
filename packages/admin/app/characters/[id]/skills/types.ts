/**
 * Shared types for the interactive skill UI.
 *
 * A `SkillSlotItem` is a fully-resolved, serializable view of one learned
 * skill — the server component joins the DB row with its skill definition +
 * icon URL + current-level stats so the client components need no lookups.
 *
 * @module characters/[id]/skills/types
 */

/** Per-level stats for the currently learned level. */
interface SkillLevelSnapshot {
  abilityMin?: number;
  abilityMax?: number;
  probability?: number;
  reqMp?: number;
  reqFp?: number;
  cooldown?: number;
  castingTime?: number;
  skillRange?: number;
  skillTime?: number;
  skillCount?: number;
  destParams?: number[];
  adjParamVals?: number[];
  chgParamVals?: number[];
}

export interface SkillSlotItem {
  /** skills DB row id. */
  id: number;
  /** Skill slot index (0–44). */
  slot: number;
  /** Skill definition id (SI_*). */
  skillId: number;
  /** Currently learned skill level. */
  level: number;

  // Resolved from the skill definition:
  name: string;
  description?: string;
  iconUrl: string;
  tier: number;
  job: number;
  maxLevel: number;
  element?: number;
  resourceType: number;
  reqLevel?: number;
  weaponType?: number;
  exeTarget?: number;
  /** Snapshot of the stats at the character's current learned level. */
  currentLevel?: SkillLevelSnapshot;
}

/** TIER_* labels from defineJob.h. */
export const TIER_LABELS: Record<number, string> = {
  0: "Base",
  1: "Expert",
  2: "Pro",
  4: "Common",
  5: "Master",
  6: "Hero",
};

/** resourceType labels (KT_* -- what the skill costs to use). */
export const RESOURCE_TYPE_LABELS: Record<number, string> = {
  0: "None",
  1: "MP",
  2: "FP",
};

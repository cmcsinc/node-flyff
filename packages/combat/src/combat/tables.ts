/**
 * Fixed combat data tables + enums -- ported from v19 C++ source.
 *
 * Job data (`JOB_TABLE`, `getJobProps`, `JobProps`) now lives in
 * `@flyff/entities` (shared with CPlayer vitals). Re-exported here so legacy
 * `from './tables'` importers keep resolving; new code should import job data
 * from `@flyff/entities` directly.
 *
 * Remaining here: damage pipeline enums (`ATK_SPEED_PLUS`, `ELEMENT_MATCH`,
 * `AF_*`, `WT_*`, `ATK_*`, `MIN_HR`/`MAX_HR`) used only by `combat/formulas`.
 *
 * @module combat/tables
 */

// Job data moved to @flyff/entities -- re-export for transition.
export { JOB_TABLE, JOB_VAGRANT, getJobProps } from '@flyff/entities';
export type { JobProps } from '@flyff/entities';

/**
 * `ATK_SPEED_PLUS_TABLE` (`MoverAttack.cpp:71`). Indexed by `clamp(A/10, 0, 17)`
 * inside `GetAttackSpeed`. Adds to the base `(50/(200-A))/2` speed.
 */
export const ATK_SPEED_PLUS: readonly number[] = [
  0.08, 0.16, 0.24, 0.32, 0.40, 0.48, 0.56, 0.64, 0.72, 0.80,
  0.88, 0.96, 1.04, 1.12, 1.20, 1.30, 1.38, 1.50,
];

/** Element enum (`MoverAttack.cpp:1275` ePropType). */
export const NO_PROP = 0;
export const FIRE = 1;
export const WATER = 2;
export const ELECTRICITY = 3;
export const WIND = 4;
export const EARTH = 5;

/**
 * propItem `element` string (item.schema) -> numeric ePropType. Weapons/armor
 * carry their inherent element as a name; the melee formula wants the enum.
 * `electric` is the schema spelling of {@link ELECTRICITY}.
 */
const ELEMENT_BY_NAME: Readonly<Record<string, number>> = Object.freeze({
  fire: FIRE, water: WATER, electric: ELECTRICITY, wind: WIND, earth: EARTH,
});

/** Map a propItem element name to its ePropType (NO_PROP when absent/unknown). */
export function elementFromName(name: string | undefined): number {
  return name ? (ELEMENT_BY_NAME[name] ?? NO_PROP) : NO_PROP;
}

/** Factor codes from the 6*6 element match table. */
const EL_NONE = 0, EL_NORMAL = 1, EL_DEF_STRONG = 2, EL_ATK_STRONG = 3;

/**
 * `ELEMENT_MATCH[atk][def]` (`MoverAttack.cpp:1275`). Translated to
 * `{ atkFactor, defFactor }` via `GetDamagePropertyFactor`: neutral -> 10000/10000,
 * atk-strong -> 15000/5000, def-strong -> 5000/15000.
 */
export const ELEMENT_MATCH: readonly (readonly number[])[] = [
  [EL_NONE, EL_NONE, EL_NONE, EL_NONE, EL_NONE, EL_NONE], // NO_PROP
  [EL_NONE, EL_NORMAL, EL_DEF_STRONG, EL_NONE, EL_ATK_STRONG, EL_NONE], // FIRE
  [EL_NONE, EL_ATK_STRONG, EL_NORMAL, EL_DEF_STRONG, EL_NONE, EL_NONE], // WATER
  [EL_NONE, EL_NONE, EL_ATK_STRONG, EL_NORMAL, EL_NONE, EL_DEF_STRONG], // ELECTRICITY
  [EL_NONE, EL_DEF_STRONG, EL_NONE, EL_NONE, EL_NORMAL, EL_ATK_STRONG], // WIND
  [EL_NONE, EL_NONE, EL_NONE, EL_ATK_STRONG, EL_DEF_STRONG, EL_NORMAL], // EARTH
];

/** Resolve an element match to the ATK/DEF multiplier pair (*10000). */
export function elementFactor(atk: number, def: number): { atkFactor: number; defFactor: number } {
  const code = ELEMENT_MATCH[atk]?.[def] ?? EL_NONE;
  switch (code) {
    case EL_ATK_STRONG: return { atkFactor: 15000, defFactor: 5000 };
    case EL_DEF_STRONG: return { atkFactor: 5000, defFactor: 15000 };
    case EL_NORMAL: return { atkFactor: 10000, defFactor: 10000 };
    default: return { atkFactor: 10000, defFactor: 10000 };
  }
}

// --- AF_* attack-result flags (`ActionMover.h:27`) --------------------------
export const AF_GENERIC = 0x0001;
export const AF_MISS = 0x0002;
export const AF_MAGIC = 0x0008;
export const AF_MELEESKILL = 0x0010;
export const AF_MAGICSKILL = 0x0020;
export const AF_CRITICAL1 = 0x0040; // 2.3* normal
export const AF_CRITICAL2 = 0x0080; // 2.6* ATK4
export const AF_CRITICAL = AF_CRITICAL1 | AF_CRITICAL2; // 0xC0 mask
export const AF_PUSH = 0x0100;
export const AF_PARRY = 0x0200;
export const AF_RESIST = 0x0400;
export const AF_STUN = 0x0800;
export const AF_BLOCKING = 0x1000;
export const AF_FORCE = 0x2000;
export const AF_RANGE = 0x4000;
export const AF_FLYING = 0x10000000; // knock-up: appends pos+angle to DAMAGE

// --- Weapon types (`GetWeaponATK` switch) ------------------------------------
export const WT_NONE = 0;
export const WT_MELEE_SWD = 1;
export const WT_MELEE_AXE = 2;
export const WT_MELEE_STICK = 3;
export const WT_MELEE_KNUCKLE = 4;
export const WT_MELEE_STAFF = 5;
export const WT_MAGIC_WAND = 6;
export const WT_MELEE_YOYO = 20;
export const WT_RANGE_BOW = 21;

// --- Attack types (`CalcATK` switch) -----------------------------------------
export const ATK_GENERIC = 0;
export const ATK_MELEESKILL = 1;
export const ATK_MAGICSKILL = 2;
export const ATK_MAGIC = 3;
export const ATK_FORCE = 4;

/** Hit-rate clamps (`GetAttackResult`, MoverAttack.cpp:241). */
export const MIN_HR = 20;
export const MAX_HR = 96;

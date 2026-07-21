/**
 * Fixed combat data tables + enums — ported from v15 C++ source.
 *
 * - `JOB_TABLE`: `Server/Resource/propJob.inc` (32 rows × 17 floats, indexed by
 *   job id 0–31; 0–15 base, 16–23 master, 24–31 hero). Mirrors
 *   `_Common/MoverParam.cpp` `GetJobProp()`.
 * - `ATK_SPEED_PLUS`: `MoverAttack.cpp:71`.
 * - `ELEMENT_MATCH`: `MoverAttack.cpp:1275` (atk-row × def-col → factor code).
 * - `AF_*`: `ActionMover.h:27`. `WT_*`: weapon types. `ATK_*`: attack types.
 *
 * Frozen — game data. Loaded once, shared across all combat calls.
 *
 * @module combat/tables
 */

/** One `propJob.inc` row — 17 floats in source column order. */
export interface JobProps {
  readonly fAttackSpeed: number;
  readonly fFactorMaxHP: number;
  readonly fFactorMaxMP: number;
  readonly fFactorMaxFP: number;
  readonly fFactorDef: number;
  readonly fFactorHPRec: number;
  readonly fFactorMPRec: number;
  readonly fFactorFPRec: number;
  readonly fMeleeSWD: number;
  readonly fMeleeAXE: number;
  readonly fMeleeSTAFF: number;
  readonly fMeleeSTICK: number;
  readonly fMeleeKNUCKLE: number;
  readonly fMagicWAND: number;
  readonly fBlocking: number;
  readonly fMeleeYOYO: number;
  readonly fCritical: number;
}

function job(
  as: number, hp: number, mp: number, fp: number, def: number,
  hpR: number, mpR: number, fpR: number,
  swd: number, axe: number, staff: number, stick: number, knuckle: number, wand: number,
  block: number, yoyo: number, crit: number,
): JobProps {
  return {
    fAttackSpeed: as, fFactorMaxHP: hp, fFactorMaxMP: mp, fFactorMaxFP: fp, fFactorDef: def,
    fFactorHPRec: hpR, fFactorMPRec: mpR, fFactorFPRec: fpR,
    fMeleeSWD: swd, fMeleeAXE: axe, fMeleeSTAFF: staff, fMeleeSTICK: stick,
    fMeleeKNUCKLE: knuckle, fMagicWAND: wand, fBlocking: block, fMeleeYOYO: yoyo, fCritical: crit,
  };
}

/** Standalone VAGRANT row — the fallback for out-of-range job ids + NPCs. */
const JOB_VAGRANT: JobProps = job(75, 0.9, 0.3, 0.3, 1.0, 1.2, 0.5, 0.5, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 0.2, 4.2, 1.0);

/**
 * `propJob.inc` rows indexed by job id (`defineJob.h:41`).
 * NPCs always use index 0 (VAGRANT) per `GetJobProp()`.
 */
export const JOB_TABLE: readonly JobProps[] = [
  JOB_VAGRANT, // 0  VAGRANT
  job(80, 1.5, 0.5, 0.7, 1.35, 1.6, 0.5, 1.0, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 0.8, 4.2, 1.0), // 1  MERCENARY
  job(75, 1.4, 0.5, 0.5, 1.4, 1.7, 0.5, 0.5, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 0.5, 4.2, 1.0), // 2  ACROBAT
  job(70, 1.4, 1.3, 0.6, 1.2, 1.6, 0.5, 1.0, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 0.5, 4.2, 1.0), // 3  ASSIST
  job(65, 1.4, 1.7, 0.3, 1.2, 1.5, 1.75, 0.6, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 0.2, 4.2, 1.0), // 4  MAGICIAN
  job(75, 1.6, 0.5, 0.5, 1.2, 1.2, 0.5, 0.5, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 0.2, 4.2, 1.0), // 5  PUPPETEER
  job(60, 2.0, 0.6, 0.9, 1.8, 2.1, 0.5, 1.4, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 1.0, 4.2, 1.0), // 6  KNIGHT
  job(90, 1.6, 0.6, 0.8, 1.5, 1.7, 0.5, 1.2, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 1.5, 4.2, 1.0), // 7  BLADE
  job(85, 1.6, 0.5, 0.7, 1.6, 2.0, 0.7, 0.5, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 0.7, 4.2, 4.0), // 8  JESTER
  job(75, 1.6, 0.5, 0.6, 1.5, 1.8, 1.3, 0.5, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 0.3, 4.2, 1.0), // 9  RANGER
  job(70, 1.6, 1.8, 0.4, 1.2, 2.3, 1.9, 1.1, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 0.6, 4.2, 1.0), // 10 RINGMASTER
  job(85, 1.8, 1.0, 0.7, 1.7, 1.9, 1.6, 1.3, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 0.7, 4.2, 1.0), // 11 BILLPOSTER
  job(70, 1.5, 2.0, 0.4, 1.3, 1.2, 1.9, 0.5, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 0.3, 4.2, 1.0), // 12 PSYCHIKEEPER
  job(70, 1.5, 2.0, 0.4, 1.3, 1.2, 2.0, 0.5, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 0.3, 4.2, 1.0), // 13 ELEMENTOR
  job(75, 0.7, 1.0, 0.5, 1.3, 1.2, 0.5, 0.5, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 0.2, 4.2, 1.0), // 14 GATEKEEPER
  job(75, 0.7, 0.5, 0.5, 1.3, 1.2, 0.5, 0.5, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 0.2, 4.2, 1.0), // 15 DOPPLER
  job(60, 2.0, 0.6, 0.9, 1.8, 2.1, 0.5, 1.4, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 1.0, 4.2, 1.0), // 16 KNIGHT_MASTER
  job(90, 1.6, 0.6, 0.8, 1.5, 1.7, 0.5, 1.2, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 1.5, 4.2, 1.0), // 17 BLADE_MASTER
  job(85, 1.6, 0.5, 0.7, 1.6, 2.0, 0.7, 0.5, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 0.7, 4.2, 4.0), // 18 JESTER_MASTER
  job(75, 1.6, 0.5, 0.6, 1.5, 1.8, 1.3, 0.5, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 0.3, 4.2, 1.0), // 19 RANGER_MASTER
  job(70, 1.6, 1.8, 0.4, 1.2, 2.3, 1.9, 1.1, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 0.6, 4.2, 1.0), // 20 RINGMASTER_MASTER
  job(85, 1.8, 1.0, 0.7, 1.7, 1.9, 1.6, 1.3, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 0.7, 4.2, 1.0), // 21 BILLPOSTER_MASTER
  job(70, 1.5, 2.0, 0.4, 1.3, 1.2, 1.9, 0.5, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 0.3, 4.2, 1.0), // 22 PSYCHIKEEPER_MASTER
  job(70, 1.5, 2.0, 0.4, 1.3, 1.2, 2.0, 0.5, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 0.3, 4.2, 1.0), // 23 ELEMENTOR_MASTER
  job(60, 2.0, 0.6, 0.9, 1.8, 2.1, 0.5, 1.4, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 1.0, 4.2, 1.0), // 24 KNIGHT_HERO
  job(90, 1.6, 0.6, 0.8, 1.5, 1.7, 0.5, 1.2, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 1.5, 4.2, 1.0), // 25 BLADE_HERO
  job(85, 1.6, 0.5, 0.7, 1.6, 2.0, 0.7, 0.5, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 0.7, 4.2, 4.0), // 26 JESTER_HERO
  job(75, 1.6, 0.5, 0.6, 1.5, 1.8, 1.3, 0.5, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 0.3, 4.2, 1.0), // 27 RANGER_HERO
  job(70, 1.6, 1.8, 0.4, 1.2, 2.3, 1.9, 1.1, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 0.6, 4.2, 1.0), // 28 RINGMASTER_HERO
  job(85, 1.8, 1.0, 0.7, 1.7, 1.9, 1.6, 1.3, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 0.7, 4.2, 1.0), // 29 BILLPOSTER_HERO
  job(70, 1.5, 2.0, 0.4, 1.3, 1.2, 1.9, 0.5, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 0.3, 4.2, 1.0), // 30 PSYCHIKEEPER_HERO
  job(70, 1.5, 2.0, 0.4, 1.3, 1.2, 2.0, 0.5, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 0.3, 4.2, 1.0), // 31 ELEMENTOR_HERO
];

/** `GetJobProp(job)` — NPCs + out-of-range → VAGRANT (job 0). */
export function getJobProps(jobId: number): JobProps {
  return JOB_TABLE[jobId] ?? JOB_VAGRANT;
}

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

/** Factor codes from the 6×6 element match table. */
const EL_NONE = 0, EL_NORMAL = 1, EL_DEF_STRONG = 2, EL_ATK_STRONG = 3;

/**
 * `ELEMENT_MATCH[atk][def]` (`MoverAttack.cpp:1275`). Translated to
 * `{ atkFactor, defFactor }` via `GetDamagePropertyFactor`: neutral → 10000/10000,
 * atk-strong → 15000/5000, def-strong → 5000/15000.
 */
export const ELEMENT_MATCH: readonly (readonly number[])[] = [
  [EL_NONE, EL_NONE, EL_NONE, EL_NONE, EL_NONE, EL_NONE], // NO_PROP
  [EL_NONE, EL_NORMAL, EL_DEF_STRONG, EL_NONE, EL_ATK_STRONG, EL_NONE], // FIRE
  [EL_NONE, EL_ATK_STRONG, EL_NORMAL, EL_DEF_STRONG, EL_NONE, EL_NONE], // WATER
  [EL_NONE, EL_NONE, EL_ATK_STRONG, EL_NORMAL, EL_NONE, EL_DEF_STRONG], // ELECTRICITY
  [EL_NONE, EL_DEF_STRONG, EL_NONE, EL_NONE, EL_NORMAL, EL_ATK_STRONG], // WIND
  [EL_NONE, EL_NONE, EL_NONE, EL_ATK_STRONG, EL_DEF_STRONG, EL_NORMAL], // EARTH
];

/** Resolve an element match to the ATK/DEF multiplier pair (×10000). */
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
export const AF_CRITICAL1 = 0x0040; // 2.3× normal
export const AF_CRITICAL2 = 0x0080; // 2.6× ATK4
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

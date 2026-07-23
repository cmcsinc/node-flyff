/**
 * `propJob.inc` job table -- shared by entities (CPlayer max-HP/MP formulas)
 * and combat (weapon ATK scaling). Lives in `@flyff/entities` so both layers
 * read one source of truth without a combat<->entities value cycle.
 *
 * `Server/Resource/propJob.inc` (32 rows * 17 floats, indexed by job id 0-31;
 * 0-15 base, 16-23 master, 24-31 hero). Mirrors `_Common/MoverParam.cpp`
 * `GetJobProp()`.
 *
 * @module entities/tables/job
 */

/** One `propJob.inc` row -- 17 floats in source column order. */
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

/** Standalone VAGRANT row -- the fallback for out-of-range job ids + NPCs. */
export const JOB_VAGRANT: JobProps = job(75, 0.9, 0.3, 0.3, 1.0, 1.2, 0.5, 0.5, 4.5, 5.5, 0.8, 3.0, 5.0, 6.0, 0.2, 4.2, 1.0);

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

/** `GetJobProp(job)` -- NPCs + out-of-range -> VAGRANT (job 0). */
export function getJobProps(jobId: number): JobProps {
  return JOB_TABLE[jobId] ?? JOB_VAGRANT;
}

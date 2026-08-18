/**
 * Vitals (HP/MP/FP) max + recovery math -- pure port of the C++
 * `GetMaxOriginHitPoint` / `ManaPoint` / `FatiguePoint` + `ProcessRecovery`
 * stand branch.
 *
 * Carved out of `combat/formulas.ts` so the recovery system + CPlayer ctor
 * read it from `@flyff/entities` without a combat<->entities edge.
 *
 * @module entities/math/vitals
 */

import type { JobProps } from '../tables/job';
import { EMPTY_PARAM_VIEW } from '../params/ParamModel';
import type { ParamView } from '../params/ParamModel';
import { DST } from '../constants/dst';

/**
 * `CMover::GetMaxOriginHitPoint` player branch (`MoverParam.cpp:2871`):
 *   a = fFactorMaxHP * level / 2
 *   b = a * ((level+1)/4) * (1 + sta/50) + sta*10
 *   maxHP = b + 80
 * The DB `max_hp`/`max_mp` columns are stale caches -- the client computes this
 * formula itself and displays the result (e.g. 236 at lvl 1 vagrant), so the
 * server MUST derive max the same way or regen clamps against a wrong ceiling
 * and HP/MP/FP never visibly recover. Pure; caller assigns + syncs.
 */
export function maxHitPoint(level: number, sta: number, fFactorMaxHP: number): number {
  const lv = Math.max(1, level);
  const a = (fFactorMaxHP * lv) / 2.0;
  const b = a * ((lv + 1.0) / 4.0) * (1.0 + sta / 50.0) + sta * 10.0;
  return Math.floor(b + 80.0);
}

/**
 * `CMover::GetMaxOriginManaPoint` player branch (`MoverParam.cpp:2904`):
 *   maxMP = (((level*2) + (int*8)) * fFactorMaxMP) + 22 + (int * fFactorMaxMP)
 * Same reasoning as `maxHitPoint` -- DB `max_mp` is a stale cache, derive live.
 */
export function maxManaPoint(level: number, int_: number, fFactorMaxMP: number): number {
  const lv = Math.max(1, level);
  return Math.floor((((lv * 2.0) + int_ * 8.0) * fFactorMaxMP) + 22.0 + int_ * fFactorMaxMP);
}

/**
 * `CMover::GetMaxFatiguePoint` player base (`MoverParam.cpp:2910/2932`):
 *   `((level*2 + sta*6) * fFactorMaxFP) + (sta * fFactorMaxFP)`
 */
export function maxFatiguePoint(level: number, sta: number, fFactorMaxFP: number): number {
  const lv = Math.max(1, level);
  return Math.floor((lv * 2.0 + sta * 6.0) * fFactorMaxFP + sta * fFactorMaxFP);
}

/**
 * Stand regen amounts per 3 s tick (`ProcessRecovery` stand branch,
 * `Mover.cpp:8381`, formulas `GetHPRecovery`/`GetMPRecovery`/`GetFPRecovery`,
 * `MoverParam.cpp:3135-3183`). `level` is clamped `>= 1` to guard the
 * `/ (500*level)` term. Pure: the caller mutates the entity + sends the
 * SETPOINTPARAM sync (`RecoverySystem`). Negatives clamp to 0.
 */
export interface RecoveryAmount { readonly hp: number; readonly mp: number; readonly fp: number; }

/**
 * `__RECOVERY10` (v9+) 10% shave -- `MoverParam.cpp:3147`.
 *
 * ```cpp
 * int nValue = (int)( <formula> );            // truncate #1
 * nValue     = (int)( nValue - nValue*0.1f ); // truncate #2
 * ```
 *
 * The C++ truncates to `int` **before** shaving, so the shave operates on a
 * whole number. Folding both into `floor(sum * 0.9)` is NOT equivalent: a sum
 * of 11.2 gives C++ `trunc(11 - 1.1) = 9` but the folded form
 * `floor(11.2*0.9) = 10`. Values are non-negative here, so `Math.floor` is the
 * right stand-in for the C-cast.
 */
function recovery10(sum: number): number {
  const nValue = Math.floor(sum);
  return Math.floor(nValue - nValue * 0.1);
}

export function standRecovery(
  level: number,
  sta: number,
  int_: number,
  maxHp: number,
  maxMp: number,
  maxFp: number,
  job: JobProps,
  params: ParamView = EMPTY_PARAM_VIEW,
): RecoveryAmount {
  const lv = Math.max(1, level);
  const baseHp = recovery10((lv / 3) + maxHp / (500 * lv) + sta * job.fFactorHPRec);
  const baseMp = recovery10((lv * 1.5 + maxMp / (500 * lv) + int_ * job.fFactorMPRec) * 0.2);
  const baseFp = recovery10((lv * 2 + maxFp / (500 * lv) + sta * job.fFactorFPRec) * 0.2);
  // C++ `GetParam(DST_HP_RECOVERY, nValue)` -- flat addition from equip/buff DST.
  // `ParamView.get` returns `def + adj`, so pass 0 and add to base.
  const hp = baseHp + params.get(DST.HP_RECOVERY, 0);
  const mp = baseMp + params.get(DST.MP_RECOVERY, 0);
  const fp = baseFp + params.get(DST.FP_RECOVERY, 0);
  return { hp: Math.max(0, hp), mp: Math.max(0, mp), fp: Math.max(0, fp) };
}

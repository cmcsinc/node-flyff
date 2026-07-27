/**
 * Experience math -- pure port of the C++ exp-grant + death-penalty pipeline.
 *
 * Carved out of `combat/formulas.ts` so non-combat consumers (join/revival/
 * quest) read it from `@flyff/entities` without a combat<->entities edge.
 *
 * `m_nExp` mirrors C++ `m_nExp1`: the **within-level** exp (progress toward
 * the next level, 0 at each level boundary). The DB `exp` column AND the
 * SETEXPERIENCE wire field ALSO store this within-level value -- there is no
 * cumulative form. The per-level threshold to advance is the NEXT level's
 * `nExp1` table value (C++ `MoverParam.cpp:1326`: `m_nExp1 >= m_aExpCharacter[
 * level+1].nExp1`), so `expToNextLevel(L) = EXP_TABLE[L+1].nExp1`.
 *
 * @module entities/math/exp
 */

import { EXP_TABLE, MAX_LEVEL } from './expTable';
import { EMPTY_PARAM_VIEW } from '../params/ParamModel';
import type { ParamView } from '../params/ParamModel';
import { DST } from '../constants/dst';

/**
 * `AddExperienceSolo` level-diff multiplier (Mover.cpp:6085).
 * `playerLevel - monsterLevel`: <=0->1.0, 1-2->0.7, 3-4->0.4, >=5->0.1.
 */
export function expLevelDiffMult(playerLevel: number, monsterLevel: number): number {
  const delta = playerLevel - monsterLevel;
  if (delta <= 0) return 1.0;
  if (delta <= 2) return 0.7;
  if (delta <= 4) return 0.4;
  return 0.1;
}

/**
 * Within-level exp threshold to advance FROM `level` TO `level+1`. Per C++
 * `MoverParam.cpp:1326`, this is **the next level's raw `nExp1`** (the table
 * is indexed "exp needed at level N-1 to reach N"), NOT a delta. 0 at/above
 * the cap (no further progression).
 */
export function expToNextLevel(level: number): number {
  return EXP_TABLE[level + 1]?.nExp1 ?? 0;
}

export interface ExpGainResult {
  /** New level after applying `amount`. */
  readonly level: number;
  /** Remaining within-level exp (0 at exact level boundary). */
  readonly exp: number;
  /** Levels gained (0 if no level-up). */
  readonly levelsGained: number;
}

/**
 * `AddExperienceSolo` + `LevelUp` cascade. `exp` is **within-level** (progress
 * toward the next level, 0 at each boundary). Adds `amount`, then while enough
 * exp remains to advance, subtracts the per-level cost and levels up -- carrying
 * any excess into the next level. Caps at {@link MAX_LEVEL}.
 *
 * Pure: caller mutates the entity + fires side effects (HP/MP refill, packets,
 * persist) based on {@link ExpGainResult.levelsGained}.
 */
export function addExp(level: number, exp: number, amount: number): ExpGainResult {
  let newExp = exp + amount;
  let newLevel = level;
  while (newLevel < MAX_LEVEL) {
    const need = expToNextLevel(newLevel);
    if (need <= 0 || newExp < need) break;
    newExp -= need;
    newLevel++;
  }
  return { level: newLevel, exp: newExp, levelsGained: newLevel - level };
}

/**
 * `CMover::SubDieDecExp` + `GetDieDecExpRate` (`_Common/Mover.cpp:7333-7346`).
 * Death exp penalty, applied on **revive** (not on death itself). Subtracts a %
 * of the exp needed for the current level off the within-level `m_nExp`,
 * clamped at 0.
 *
 * v19 C++ never de-levels here (`bLvDown` forcibly reset at `Mover.cpp:7189`),
 * so the level is unchanged.
 *
 * Loss % by level bracket -- simplified from `DiePenalty.inc:35-60`
 * (Lv<=20=0%, Lv<=29=6%, Lv<=59=5%, Lv<=89=4%, Lv<=99=3%, Lv<=109=2%,
 * Lv<=129=1.5%, Lv<=200=1%).
 *
 * Modifiers (`GetDieDecExpRate`, Mover.cpp:7333):
 * - `DST_RECOVERY_EXP` (Resurrection skill): reduces penalty by
 *   `(100 - n) / 100` where `n` is the DST value (e.g. 50 → halved).
 * - SM_REVIVAL + chaotic: 0.9x penalty (ponytail: no SM tracking yet).
 * - SM_REVIVAL alone (not chaotic): zero penalty (ponytail).
 *
 * ponytail: load the real `DiePenalty.inc` table when the resource converter
 * exports it; the bracket values then come from data, not code.
 */
export function subDieDecExp(
  level: number,
  exp: number,
  params: ParamView = EMPTY_PARAM_VIEW,
): { level: number; exp: number } {
  const pct = deathExpLossPct(level);
  if (pct <= 0) return { level, exp: Math.max(0, exp) };
  let loss = Math.floor(expToNextLevel(level) * pct);
  // C++ `GetDieDecExpRate` -- DST_RECOVERY_EXP reduces penalty.
  const recoveryPct = params.get(DST.RECOVERY_EXP, 0);
  if (recoveryPct > 0) {
    const factor = (100 - recoveryPct) / 100;
    loss = Math.floor(loss * factor);
  }
  // ponytail: SM_REVIVAL + chaotic → 0.9x; SM_REVIVAL alone → 0.
  // No SM mode tracking yet; add when SM_REVIVAL buff lands.
  return { level, exp: Math.max(0, exp - loss) };
}

/** `DECEXP_PENALTY` bracket -- % of current-level exp lost on town revive. */
function deathExpLossPct(level: number): number {
  if (level <= 20) return 0;
  if (level <= 29) return 0.06;
  if (level <= 59) return 0.05;
  if (level <= 89) return 0.04;
  if (level <= 99) return 0.03;
  if (level <= 109) return 0.02;
  if (level <= 129) return 0.015;
  return 0.01;
}

// NOTE: there is NO cumulative exp form. The C++ `m_nExp1`, the DB `exp`
// column, and the SETEXPERIENCE wire field are ALL the same within-level
// value (progress toward the next level, 0 at each boundary). The previous
// `withinLevelExp` / `cumulativeExp` helpers were based on a misread of the
// table as cumulative -- it is per-level thresholds (see expTable.ts).

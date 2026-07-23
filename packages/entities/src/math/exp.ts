/**
 * Experience math -- pure port of the C++ exp-grant + death-penalty pipeline.
 *
 * Carved out of `combat/formulas.ts` so non-combat consumers (join/revival/
 * quest) read it from `@flyff/entities` without a combat<->entities edge.
 *
 * `m_nExp` is **within-level** (progress toward the next level, 0 at each
 * boundary). The DB `exp` column + SETEXPERIENCE wire field store cumulative
 * -- convert via `withinLevelExp` / `cumulativeExp`.
 *
 * @module entities/math/exp
 */

import { EXP_TABLE, MAX_LEVEL } from './expTable';

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
 * Exp needed to advance FROM `level` TO `level+1` (delta of cumulative nExp1).
 * 0 if `level` is invalid or at/above the cap (no further progression).
 */
export function expToNextLevel(level: number): number {
  const cur = EXP_TABLE[level]?.nExp1;
  const next = EXP_TABLE[level + 1]?.nExp1;
  if (cur === undefined || next === undefined) return 0;
  return Math.max(0, next - cur);
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
 * `CMover::SubDieDecExp` (`_Common/Mover.cpp:7157`) -- the death exp penalty,
 * applied on **revive** (not on death itself). Subtracts a % of the exp needed
 * for the current level off the within-level `m_nExp`, clamped at 0.
 *
 * v15 C++ never de-levels here (`bLvDown` forcibly reset at `Mover.cpp:7189`),
 * so the level is unchanged.
 *
 * Loss % by level bracket -- simplified from `DiePenalty.inc:35-60`
 * (Lv<=20=0%, Lv<=29=6%, Lv<=59=5%, Lv<=89=4%, Lv<=99=3%, Lv<=109=2%,
 * Lv<=129=1.5%, Lv<=200=1%).
 *
 * ponytail: load the real `DiePenalty.inc` table when the resource converter
 * exports it; the bracket values then come from data, not code.
 */
export function subDieDecExp(level: number, exp: number): { level: number; exp: number } {
  const pct = deathExpLossPct(level);
  if (pct <= 0) return { level, exp: Math.max(0, exp) };
  const loss = Math.floor(expToNextLevel(level) * pct);
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

/**
 * Within-level exp = cumulative exp - the level's `nExp1` base. Used to convert
 * the cumulative value stored in the DB / sent on the wire into the live
 * within-level `m_nExp`. Clamps >= 0 (a malformed row cannot give negative exp).
 */
export function withinLevelExp(cumulativeExp: number, level: number): number {
  const base = EXP_TABLE[level]?.nExp1 ?? 0;
  return Math.max(0, cumulativeExp - base);
}

/**
 * Cumulative exp = level's `nExp1` base + within-level exp. The SETEXPERIENCE
 * snapshot (`nExp1`) and the DB `exp` column both store cumulative, per the C++
 * `m_nExp1` semantics.
 */
export function cumulativeExp(level: number, exp: number): number {
  return (EXP_TABLE[level]?.nExp1 ?? 0) + exp;
}

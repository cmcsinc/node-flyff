/**
 * EXP as a percentage of the current level's bar.
 *
 * The DB `exp` column is **within-level** exp (C++ `m_nExp1`), and the client
 * draws the bar as `m_nExp1 / m_aExpCharacter[level+1].nExp1`
 * (`MoverParam.cpp:488`) — so a percentage is only meaningful together with the
 * level. Raw within-level values run into the billions past L100, which makes a
 * raw number field unusable in the admin form; percent is the same information
 * in the units the game shows.
 *
 * See memory `flyff-exp-within-level-model`.
 */

import { EXP_TABLE } from '@flyff/entities/math/expTable';

/**
 * Within-level exp needed to advance FROM `level` TO `level + 1` — the next
 * level's raw `nExp1`, NOT a delta (`MoverParam.cpp:1326`). `0` means no
 * further progression (level cap), in which case percent is undefined.
 */
export function expThreshold(level: number): number {
  return EXP_TABLE[level + 1]?.nExp1 ?? 0;
}

/** Raw within-level exp → 0–100. `0` when the level has no bar (cap). */
export function expToPercent(exp: string, level: number): number {
  const threshold = expThreshold(level);
  const raw = Number(exp);
  if (threshold <= 0 || !Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(100, (raw / threshold) * 100);
}

/** 0–100 → raw within-level exp, clamped to the level's bar. */
export function percentToExp(percent: number, level: number): string {
  const threshold = expThreshold(level);
  if (threshold <= 0 || !Number.isFinite(percent) || percent <= 0) return '0';
  const clamped = Math.min(100, percent);
  return String(Math.min(threshold, Math.round((clamped / 100) * threshold)));
}

/** Percent for display in an input: trimmed to 2 decimals, no trailing zeros. */
export function formatPercent(percent: number): string {
  if (percent <= 0) return '0';
  return String(Number(percent.toFixed(2)));
}

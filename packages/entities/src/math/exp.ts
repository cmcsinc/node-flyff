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
 * `CMover::GetExperienceReduceFactor` (Mover.cpp:6650) -- the **party** exp
 * reduction, which is a DIFFERENT curve from the solo {@link expLevelDiffMult}.
 *
 * Keyed on `nMaxLevel - monsterLevel` where `nMaxLevel` is the highest level
 * among the party members NEARBY the kill (not the killer's level), clamped to
 * 9. Non-KOR table (`::GetLanguage() != LANG_KOR` branch); the KOR branch is a
 * coarser 4-value curve we do not use.
 *
 * ponytail: KOR table selection -- add when a locale switch exists.
 */
export function expPartyReduceFactor(monsterLevel: number, maxPartyLevel: number): number {
  const delta = maxPartyLevel - monsterLevel;
  if (delta <= 0) return 1.0;
  const factors = [0.8, 0.8, 0.6, 0.35, 0.2, 0.12, 0.08, 0.04, 0.02, 0.01];
  return factors[Math.min(delta, 9)] ?? 0.01;
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
 * any excess into the next level. Caps at {@link MAX_LEVEL} by default, or at
 * `levelCap` when provided (per-job-type cap -- see {@link jobLevelCap}).
 *
 * Per-job cap mirrors C++ `AddExperience` (`MoverParam.cpp:1224-1247`): a Vagrant
 * (`IsBaseJob`) cannot gain exp past `MAX_JOB_LEVEL` (15) -- the exp clamps to 0
 * and no level-up fires. Pass `levelCap = 15` to reproduce that. At/above the
 * cap, `amount` is accepted but discarded (exp reset to 0, no progression).
 *
 * Pure: caller mutates the entity + fires side effects (HP/MP refill, packets,
 * persist) based on {@link ExpGainResult.levelsGained}.
 */
export function addExp(
  level: number,
  exp: number,
  amount: number,
  levelCap: number = MAX_LEVEL,
): ExpGainResult {
  // C++ `AddExperience` pre-check: at/above the job cap, exp clamps to 0 and the
  // gain is silently accepted (no level-up). Mirrors `m_nExp1 = 0; return TRUE`.
  if (level >= levelCap) {
    return { level, exp: 0, levelsGained: 0 };
  }
  let newExp = exp + amount;
  let newLevel = level;
  while (newLevel < levelCap) {
    const need = expToNextLevel(newLevel);
    if (need <= 0 || newExp < need) break;
    newExp -= need;
    newLevel++;
  }
  // C++ `AddExperience` level-up cascade (MoverParam.cpp:1464): when the cap
  // blocks further leveling, m_nExp1 is set to 0 (set at line 1455
  // pre-emptively and the excess nExptmp is discarded because bLevelUp=FALSE
  // skips the recursive AddExperience call at line 1604). Match that: if the
  // cascade stopped because we hit the cap, the leftover is discarded.
  if (newLevel >= levelCap) {
    newExp = 0;
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
 * `recoveryPct` is the C++ `dwDestParam` argument
 * (`Mover.h:1555: SubDieDecExp(BOOL bTransfer=TRUE, DWORD dwDestParam=0, BOOL
 * bResurrection=FALSE)`). It is the percentage of the penalty that is **still
 * applied**, NOT the percentage forgiven -- `GetDieDecExpRate`
 * (`Mover.cpp:7333`) computes `fAddDec = (100 - dwDestParam)/100; fDecExp -=
 * fDecExp * fAddDec;` which algebraically nets `fDecExp * dwDestParam/100`.
 * 0 (the default) means "no modifier", i.e. the full bracket loss.
 *
 * The only caller that passes a nonzero value is the other-player Resurrection
 * accept path (`DPSrvr.cpp:6908`), which forwards the skill's `nAdjParamVal2`
 * when `dwDestParam2 == DST_RECOVERY_EXP`. Skill 45 ships 100 at L1 (full
 * penalty) down to 60 at L20 (40% forgiven). Both self-revive paths
 * (`OnRevival`, `OnRevivalLodestar`) call `SubDieDecExp()` with no args.
 *
 * DIVERGENCE FIXED (2026-08-13): this used to read the pct off the target's
 * `DST_RECOVERY_EXP` param and apply `loss * (100 - pct)/100` -- the inverse of
 * the C++ curve, and from a source C++ never consults here. A skill value of
 * 100 ("full penalty") would have forgiven the penalty entirely.
 *
 * ponytail: `bResurrection` + SM_REVIVAL interaction (`Mover.cpp:7342-7345`:
 * chaotic + (SM_REVIVAL || bResurrection) -> 0.9x; SM_REVIVAL alone -> 0). No SM
 * mode tracking yet.
 * ponytail: load the real `DiePenalty.inc` table when the resource converter
 * exports it; the bracket values then come from data, not code.
 */
export function subDieDecExp(
  level: number,
  exp: number,
  recoveryPct = 0,
): { level: number; exp: number } {
  const pct = deathExpLossPct(level);
  if (pct <= 0) return { level, exp: Math.max(0, exp) };
  let loss = Math.floor(expToNextLevel(level) * pct);
  if (recoveryPct > 0) {
    loss = Math.floor((loss * Math.min(100, recoveryPct)) / 100);
  }
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

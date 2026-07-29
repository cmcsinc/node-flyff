/**
 * Job-change autofill — level / GP / stat targets for a class switch.
 *
 * Ported from the `mada_*` / `mafl_*` job-master dialogue scripts plus the
 * script functions they call (`_Common/ScriptLib.cpp`, `_Common/Mover.cpp`):
 *
 *   1st job  (expert 1-5)      Vagrant @15 → ChangeJob(n); InitStat()
 *   2nd job  (pro 6-15)        Expert  @60 → ChangeJob(n)                  [no InitStat]
 *   Master   (16-23)           Pro     @120→ ChangeJob(n); InitStat(); SetLevel(60); AddGPPoint(-120)
 *   Hero     (24-31)           Master  @120→ ChangeJob(n); SetLevel(121); AddGPPoint(+15)
 *   Legend   (32-39)           Hero    @130→ ChangeJob(n)                  [no level/stat change]
 *
 * `InitStat` (ScriptLib.cpp:570) sets STR/DEX/STA/INT to 15 each and
 * `m_nRemainGP = (level - 1) * 2` — which matches summing `EXPCHARACTER.dwLPPoint`
 * (a flat 2 per level in v19's expTable.inc) from level 2 up.
 *
 * The Master case is worth checking by hand: InitStat runs while still level 120
 * → GP 238, SetLevel(60) leaves GP alone, then -120 → 118 = (60-1)*2. So Master
 * lands exactly on the GP total for its new level. We compute it that way.
 *
 * ponytail: the dialogues also gate on a completed job quest (QUEST_VOCMER_TRN3,
 * QUEST_MASTER, …) and, for Master/Hero, `GetPlayerExpPercent() == 9999`. Admin
 * edits deliberately skip those gates — this module only supplies the numbers the
 * scripts would have produced.
 */

/** `defineJob.h` tier boundaries. */
const MAX_JOBBASE = 1;
const MAX_EXPERT = 6;
const MAX_PROFESSIONAL = 16;
const MAX_MASTER = 24;
const MAX_HERO = 32;
const MAX_LEGEND_HERO = 40;

/** `InitStat` baseline for each of STR/DEX/STA/INT. */
export const BASE_STAT = 15;

/** `EXPCHARACTER.dwLPPoint` — flat 2 GP per level gained in v19's expTable.inc. */
const GP_PER_LEVEL = 2;

export type JobTier = "base" | "expert" | "pro" | "master" | "hero" | "legend";

export function jobTier(job: number): JobTier | null {
  if (job < 0) return null;
  if (job < MAX_JOBBASE) return "base";
  if (job < MAX_EXPERT) return "expert";
  if (job < MAX_PROFESSIONAL) return "pro";
  if (job < MAX_MASTER) return "master";
  if (job < MAX_HERO) return "hero";
  if (job < MAX_LEGEND_HERO) return "legend";
  return null;
}

/** GP a character has earned by reaching `level` with nothing spent (`InitStat`). */
export function gpForLevel(level: number): number {
  return Math.max(0, (level - 1) * GP_PER_LEVEL);
}

export interface JobChangePlan {
  /** Level the character should end on. */
  level: number;
  /** Unspent GP after the change. */
  remainGp: number;
  /** STR/DEX/STA/INT, or null when the tier does not reset stats. */
  stats: { strength: number; dexterity: number; stamina: number; intelligence: number } | null;
  /** Human-readable summary of what the autofill did and which script it mirrors. */
  note: string;
}

/**
 * Computes the level / GP / stat targets for switching to `targetJob`.
 *
 * `current` supplies the values carried over by tiers that do not reset
 * (Hero adds GP to the existing pool; Legend changes nothing).
 * Returns null for an unknown job id.
 */
export function planJobChange(
  targetJob: number,
  current: { level: number; remainGp: number },
): JobChangePlan | null {
  const tier = jobTier(targetJob);
  if (tier === null) return null;

  const reset = {
    strength: BASE_STAT,
    dexterity: BASE_STAT,
    stamina: BASE_STAT,
    intelligence: BASE_STAT,
  };

  switch (tier) {
    case "base":
      return {
        level: 1,
        remainGp: gpForLevel(1),
        stats: reset,
        note: "Vagrant — level 1, stats reset to 15, GP 0.",
      };
    case "expert":
      return {
        level: 15,
        remainGp: gpForLevel(15),
        stats: reset,
        note: "1st job — level 15 (MAX_JOB_LEVEL), InitStat: stats 15, GP 28.",
      };
    case "pro":
      return {
        level: 60,
        remainGp: current.remainGp,
        stats: null,
        note: "2nd job — level 60 (MAX_JOB_LEVEL+MAX_EXP_LEVEL). The mada_* scripts do NOT call InitStat here, so stats and GP carry over.",
      };
    case "master":
      return {
        level: 60,
        remainGp: gpForLevel(60),
        stats: reset,
        note: "Master — InitStat at 120 then SetLevel(60) + AddGPPoint(-120): level 60, stats 15, GP 118.",
      };
    case "hero":
      return {
        level: 121,
        remainGp: current.remainGp + 15,
        stats: null,
        note: "Hero — SetLevel(121) + AddGPPoint(15). No InitStat: stats carry over, GP gains 15.",
      };
    case "legend":
      return {
        level: Math.max(current.level, 130),
        remainGp: current.remainGp,
        stats: null,
        note: "Legend Hero — requires level 130; the script changes job only, no level/stat/GP change.",
      };
  }
}

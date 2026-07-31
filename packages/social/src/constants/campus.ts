/**
 * Campus (master/pupil mentoring) constants.
 *
 * `__CAMPUS` is commented out in `WORLDSERVER/VersionCommon.h:233`, but every
 * campus guard in the code is `#if __VER >= 15` and `__VER` is 19 -- so campus
 * IS compiled and active in the v19 server. Do not be misled by the define.
 *
 * Sources: `_Common/Campus.h:14-19`, `WORLDSERVER/CampusHelper.h:16-18`,
 * `game/resource/Campus.lua`, `game/resource/defineText.h:3457-3471`.
 *
 * @module social/constants/campus
 */

/** `CAMPUS_MASTER` (`Campus.h:14`) -- member level for the mentor. */
export const CAMPUS_MASTER = 1;
/** `CAMPUS_PUPIL` (`Campus.h:15`) -- member level for a student. */
export const CAMPUS_PUPIL = 2;

/** `MAX_PUPIL_NUM` (`Campus.h:17`) -- hard ceiling on pupils per campus. */
export const MAX_PUPIL_NUM = 3;
/** `MIN_LV2_POINT` (`Campus.h:18`) -- campus points needed for a 2nd pupil slot. */
export const MIN_LV2_POINT = 41;
/** `MIN_LV3_POINT` (`Campus.h:19`) -- campus points needed for a 3rd pupil slot. */
export const MIN_LV3_POINT = 101;

/** `COMPLETE_PUPIL_LEVEL` (`CampusHelper.h:16`) -- graduation level; auto-dissolves. */
export const COMPLETE_PUPIL_LEVEL = 75;
/** `MIN_MASTER_LEVEL` (`CampusHelper.h:17`) -- minimum level to mentor. */
export const MIN_MASTER_LEVEL = 91;
/** `REMOVE_CAMPUS_POINT` (`CampusHelper.h:18`) -- points the dissolver forfeits. */
export const REMOVE_CAMPUS_POINT = 5;

/**
 * `MAX_EXPERT` (`resource/defineJob.h:258`) -- `IsPupilLevel` is a JOB test, not
 * a level test: `pUser->GetJob() < MAX_EXPERT`. Everything below `JOB_KNIGHT`
 * (16) qualifies, i.e. vagrant plus all first-job expert classes. The `6` at
 * defineJob.h:83 is the old commented block; v19 uses 15.
 */
export const MAX_EXPERT = 15;

/**
 * `RecoveryTime` from `Campus.lua` -- `MIN(60)` expanded via
 * `resource/LuaFunc/CampusFunc.lua:1-2` (`60 * 1000 * 60`). 60 minutes.
 */
export const CAMPUS_RECOVERY_TIME_MS = 60 * 60 * 1_000;
/** `RecoveryPoint` from `Campus.lua` -- points restored per tick. */
export const CAMPUS_RECOVERY_POINT = 1;

/**
 * `tCampusQuest` from `Campus.lua` -- quests a would-be master must have
 * completed. Exactly one entry in v19: `QUEST_SCE_MDRIGALTEACHER5`
 * (`resource/definequest.h:378`).
 */
export const CAMPUS_REQUIRED_QUESTS: readonly number[] = [1060];

/**
 * `tCampusBuff` from `Campus.lua` -- buff-level -> `II_TS_BUFF_POWER_LOVE0N`
 * item id (`resource/defineItem.h:5480-5482`). Buff level is the count of
 * ONLINE pupils for a master (0-3), or 1/0 for a pupil depending on whether the
 * master is online (`CCampus::GetBuffLevel`, `Campus.cpp:190`).
 */
export const CAMPUS_BUFF_BY_LEVEL: Readonly<Record<number, number>> = Object.freeze({
  1: 26856,
  2: 26857,
  3: 26858,
});

/**
 * `tCampusReward` from `Campus.lua` -- keyed by the PUPIL's newly reached level.
 * Rewards fire on EXACT level equality (`GetReward` is a map lookup), so a
 * multi-level jump skips them. Level 75 additionally graduates the pupil.
 */
export const CAMPUS_REWARDS: Readonly<Record<number, { master: number; pupil: number }>> =
  Object.freeze({
    15: { master: 1, pupil: 1 },
    40: { master: 1, pupil: 2 },
    60: { master: 1, pupil: 2 },
    75: { master: 2, pupil: 5 },
  });

/**
 * `chState` audit codes passed to `SendUpdateCampusPoint`
 * (`WORLDSERVER/DPDatabaseClient.cpp:4186`): recovery, level-up, dissolve.
 */
export const CAMPUS_POINT_REASON = Object.freeze({
  RECOVERY: 'R',
  LEVELUP: 'L',
  DIVORCE: 'D',
} as const);

// --- defineText.h ids (all sent to the REQUESTER, never the target) ---------
/** 4235 -- requester (or target) has not finished the campus quest. */
export const TID_GAME_TS_NOTQUEST = 4235;
/** 4236 -- the master's pupil slots are full. */
export const TID_GAME_TS_FULLSTUDENT = 4236;
/** 4243 -- neither party satisfies a master/pupil role. */
export const TID_GAME_TS_NOTLEVEL = 4243;
/** 4244 -- already in a campus. */
export const TID_GAME_TS_ALREADY = 4244;
/** 4245 -- invite refused. */
export const TID_GAME_TS_REFUSAL = 4245;
/** 4248 -- requester's own campus points are negative. */
export const TID_GAME_TS_WANTMYTSP = 4248;
/** 4249 -- target's campus points are negative. */
export const TID_GAME_TS_WANTYOURTSP = 4249;

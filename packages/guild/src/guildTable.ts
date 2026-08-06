/**
 * Guild constants + the `expCompanyTest` level table.
 *
 * Ported from `_Common/guild.h` (limits, rank caps), `resource/defineJob.h:215`
 * (rank ids), the CoreServer guards in `CORESERVER/DPCacheSrvr.cpp:1185-1855`
 * (cooldown, nickname gate, class bounds), and `resource/expTable.inc`
 * (`expCompanyTest`, parsed by `CGuildTable::ReadBlock`, `guild.cpp:187`).
 *
 * Kept separate from the manager so the service + handler can import a bound or
 * a curve without pulling in the live registry.
 *
 * @module guildTable
 */

import {
  GUD_ROOKIE, MAX_GM_LEVEL, MAX_MEMBER_LV_SIZE,
} from '@flyff/world-core';

/**
 * Rejoin lockout after leaving / being kicked / being disbanded --
 * `pPlayer->m_tGuildMember = now + CTimeSpan(2,0,0,0)`
 * (`DPCacheSrvr.cpp:1233`, `:1421`). Checked on accept-invite (`:1270`) and in
 * the `IsPartyGuild` script predicate (`ScriptLib.cpp:766`). Bypassed for
 * operators (`g_PlayerMng.IsOperator`).
 */
export const GUILD_REJOIN_COOLDOWN_MS = 2 * 24 * 60 * 60 * 1000;

/** Invite expiry. C++ has no TTL on a guild invite; matches the party pattern. */
export const GUILD_INVITE_TIMEOUT_MS = 30_000;

/**
 * Guild-nickname gate -- `OnGuildNickName` refuses below guild level 10
 * (`DPCacheSrvr.cpp:1809`, `TID_GAME_GUILDNOTLEVEL`).
 */
export const GUILD_NICKNAME_MIN_LEVEL = 10;
/** Nickname length bounds -- `nLen < 2 || nLen > 12` is rejected (`:1825`). */
export const GUILD_NICKNAME_MIN_LEN = 2;
export const GUILD_NICKNAME_MAX_LEN = 12;

/** Member sub-grade bounds -- `nClass < 0 || nClass > 2` is rejected (`:1707`). */
export const GUILD_CLASS_MIN = 0;
export const GUILD_CLASS_MAX = 2;

/**
 * `expCompanyTest` block of `expTable.inc`, parsed by `CGuildTable::ReadBlock`
 * (`guild.cpp:187`) -- `{ pxp-required, penya-required, max-members }` indexed
 * by guild LEVEL (1-based; index 0 is the unreachable level-0 row).
 *
 * The parse is look-ahead: each row's `dwPxpCount` is the number that PRECEDED
 * it in the file, so the level-2 requirement is the `24` printed on the level-2
 * line while its penya `5200` is on the same line. The table below is already
 * in per-level form -- `GUILD_TABLE[2]` is what a level-1 guild must reach.
 *
 * `GetPxpCount(nLevel)` reads `m_table[nLevel - 1]`, i.e. this array shifted;
 * we keep it 1-indexed instead so `GUILD_TABLE[level + 1]` reads naturally at
 * the level-up site (which is exactly what `AddContribution` does).
 */
export const GUILD_TABLE: readonly { readonly pxp: number; readonly penya: number; readonly maxMember: number }[] = [
  { pxp: 0, penya: 0, maxMember: 0 },                    // 0 -- unreachable
  { pxp: 0, penya: 0, maxMember: 30 },                   // 1
  { pxp: 24, penya: 5200, maxMember: 30 },               // 2
  { pxp: 205, penya: 14625, maxMember: 32 },             // 3
  { pxp: 485, penya: 34666, maxMember: 32 },             // 4
  { pxp: 1353, penya: 58035, maxMember: 34 },            // 5
  { pxp: 2338, penya: 100285, maxMember: 34 },           // 6
  { pxp: 4547, penya: 139343, maxMember: 36 },           // 7
  { pxp: 6788, penya: 208000, maxMember: 36 },           // 8
  { pxp: 11045, penya: 263250, maxMember: 38 },          // 9
  { pxp: 15151, penya: 361110, maxMember: 38 },          // 10
  { pxp: 22183, penya: 432575, maxMember: 40 },          // 11
  { pxp: 28800, penya: 561600, maxMember: 40 },          // 12
  { pxp: 39340, penya: 649113, maxMember: 42 },          // 13
  { pxp: 49135, penya: 810727, maxMember: 42 },          // 14
  { pxp: 63920, penya: 914063, maxMember: 44 },          // 15
  { pxp: 71608, penya: 1024000, maxMember: 44 },         // 16
  { pxp: 84365, penya: 1064483, maxMember: 46 },         // 17
  { pxp: 91041, penya: 1148727, maxMember: 46 },         // 18
  { pxp: 109698, penya: 1238429, maxMember: 48 },        // 19
  { pxp: 115152, penya: 1300000, maxMember: 48 },        // 20
  { pxp: 134545, penya: 1443000, maxMember: 49 },        // 21
  { pxp: 156813, penya: 1601730, maxMember: 50 },        // 22
  { pxp: 182351, penya: 1777920, maxMember: 51 },        // 23
  { pxp: 211610, penya: 1973491, maxMember: 52 },        // 24
  { pxp: 245099, penya: 2190574, maxMember: 53 },        // 25
  { pxp: 283396, penya: 2431537, maxMember: 54 },        // 26
  { pxp: 327152, penya: 2699005, maxMember: 55 },        // 27
  { pxp: 377106, penya: 2995896, maxMember: 56 },        // 28
  { pxp: 434090, penya: 3325443, maxMember: 57 },        // 29
  { pxp: 499049, penya: 3691241, maxMember: 58 },        // 30
  { pxp: 573046, penya: 4097276, maxMember: 59 },        // 31
  { pxp: 657283, penya: 4547976, maxMember: 60 },        // 32
  { pxp: 753119, penya: 5048252, maxMember: 61 },        // 33
  { pxp: 862086, penya: 5603559, maxMember: 62 },        // 34
  { pxp: 985913, penya: 6219950, maxMember: 63 },        // 35
  { pxp: 1126550, penya: 6904144, maxMember: 64 },       // 36
  { pxp: 1286198, penya: 7663599, maxMember: 65 },       // 37
  { pxp: 1467338, penya: 8506594, maxMember: 66 },       // 38
  { pxp: 1672765, penya: 9442319, maxMember: 67 },       // 39
  { pxp: 1905631, penya: 10480973, maxMember: 68 },      // 40
  { pxp: 2169488, penya: 11633879, maxMember: 69 },      // 41
  { pxp: 2468335, penya: 12913606, maxMember: 70 },      // 42
  { pxp: 2806677, penya: 14334102, maxMember: 71 },      // 43
  { pxp: 3189588, penya: 15910852, maxMember: 72 },      // 44
  { pxp: 3622778, penya: 17661045, maxMember: 73 },      // 45
  { pxp: 4112677, penya: 19603760, maxMember: 74 },      // 46
  { pxp: 4666517, penya: 21760172, maxMember: 75 },      // 47
  { pxp: 5292439, penya: 24153791, maxMember: 76 },      // 48
  { pxp: 5999599, penya: 26810707, maxMember: 77 },      // 49
  { pxp: 7075777, penya: 29759885, maxMember: 80 },      // 50
];

/** Highest guild level the table supports -- `CGuildTable::GetMaxLevel()`. */
export const MAX_GUILD_LEVEL = GUILD_TABLE.length - 1;

/** Max members at a given guild level -- `CGuild::GetMaxMemberSize` (`:508`). */
export function guildMaxMembers(level: number): number {
  return GUILD_TABLE[level]?.maxMember ?? 0;
}

/**
 * `CONTRIBUTION_RESULT` (`guild.h:230-239`) -- why a contribution was refused.
 * Each maps to a client message via `CGuild::MeritResultMsg`.
 */
export const CONTRIBUTION_OK = 0;
export const CONTRIBUTION_FAIL_MAXLEVEL = 1;
export const CONTRIBUTION_FAIL_GUILD_OVERFLOW_PXP = 2;
export const CONTRIBUTION_FAIL_GUILD_OVERFLOW_PENYA = 3;
export const CONTRIBUTION_FAIL_INVALID_CONDITION = 4;
export const CONTRIBUTION_FAIL_OVERFLOW_PXP = 5;
export const CONTRIBUTION_FAIL_OVERFLOW_PENYA = 6;

/** A `CONTRIBUTION_RESULT` value. */
export type ContributionResult =
  | typeof CONTRIBUTION_OK
  | typeof CONTRIBUTION_FAIL_MAXLEVEL
  | typeof CONTRIBUTION_FAIL_GUILD_OVERFLOW_PXP
  | typeof CONTRIBUTION_FAIL_GUILD_OVERFLOW_PENYA
  | typeof CONTRIBUTION_FAIL_INVALID_CONDITION
  | typeof CONTRIBUTION_FAIL_OVERFLOW_PXP
  | typeof CONTRIBUTION_FAIL_OVERFLOW_PENYA;

/**
 * `DWORD` ceiling -- the guild-side pools (`m_dwContributionPxp`,
 * `m_nGoldGuild`) are unsigned 32-bit in C++.
 *
 * The C++ overflow guards are written as wraparound tests
 * (`if( m_dwContributionPxp + dwPxp < m_dwContributionPxp )`, `guild.cpp:559`),
 * which only work because the arithmetic wraps. JS numbers do not wrap, so the
 * equivalent check is an explicit ceiling comparison -- same refusal, different
 * mechanism.
 */
export const MAX_DWORD = 0xffff_ffff;

/**
 * `int` ceiling -- the MEMBER-side penya counter (`m_nGiveGold`) is a signed
 * `int` while the guild-side pool is a `DWORD`, so the two overflow at
 * different points. C++ casts on the way in (`m_nGiveGold += (int)dwPenya`,
 * `guild.cpp:588`); its guard therefore trips at 2^31, not 2^32.
 */
export const MAX_INT32 = 0x7fff_ffff;

/**
 * Gem donation value -- `((dwItemLV + 1) / 2) * count` guild PXP per stack
 * (`CDPSrvr::OnGuildContribution`, `DPSrvr.cpp:1893`). Integer division, so a
 * LV-1 Twinkle Stone and a LV-2 gem are both worth 1 per unit, LV-5 Palin is 3.
 *
 * `itemLv` of 0 (a gem row whose `dwItemLV` never got emitted) yields 0, and
 * the caller skips a zero-value donation exactly as C++ does (`if( nValue > 0 )`).
 */
export function gemContributionPxp(itemLv: number, count: number): number {
  if (itemLv <= 0 || count <= 0) return 0;
  return Math.trunc((itemLv + 1) / 2) * count;
}


/**
 * Headcount cap for one RANK -- `CGuild::GetMaxMemberLvSize` (`guild.cpp:499`).
 * `GUD_ROOKIE` is uncapped beyond the whole-guild limit, every other rank uses
 * the fixed `sm_anMaxMemberLvSize` table.
 */
export function guildMaxRankMembers(rank: number, level: number): number {
  if (rank < 0 || rank >= MAX_GM_LEVEL) return 0;
  if (rank === GUD_ROOKIE) return guildMaxMembers(level);
  return MAX_MEMBER_LV_SIZE[rank] ?? 0;
}

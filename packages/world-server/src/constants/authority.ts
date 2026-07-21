/**
 * GM/admin authority ranks — mirrors `_Common/authorization.h` EXACTLY.
 *
 * C++ stores `m_dwAuthorization` per user and gates `ParsingCommand` entries
 * with `cmd.m_dwAuthorization > pMover->m_dwAuthorization ⇒ break` (ordinal
 * compare, `_Interface/FuncTextCmd.cpp:4476`). The values are ASCII bytes:
 *   AUTH_GENERAL       'S' (0x53)
 *   AUTH_GAMEMASTER    'T' (0x54)
 *   AUTH_GAMEMASTER2   'U' (0x55)
 *   AUTH_ADMINISTRATOR 'V' (0x56)
 *
 * **The values MUST match C++ verbatim** — the byte we serialize into the JOIN
 * snapshot (`mover.serializer.ts`, read back by the client into
 * `g_pPlayer->m_dwAuthorization`) is compared against the CLIENT's own
 * `AUTH_*` defines. Sending `3` makes the client reject every command
 * (even `AUTH_GENERAL`='S'=83, since `83 > 3`). Ordinal order is preserved,
 * so `hasAuthority` keeps working.
 *
 * Mapping today is binary off the `accounts.gm` boolean — GM accounts land at
 * `ADMINISTRATOR` ('V'), everyone else at `GENERAL` ('S'). ponytail: when a
 * real `account.authority` column ships, populate the intermediate tiers.
 *
 * @module constants/authority
 */

export const AUTH = Object.freeze({
  /** Player — default. C++ `AUTH_GENERAL` = 'S'. */
  GENERAL: 0x53,
  /** GM tier 1 — teleport/summon/invisible. C++ `AUTH_GAMEMASTER` = 'T'. */
  GAMEMASTER: 0x54,
  /** GM tier 2 — disconnect/notice/system. C++ `AUTH_GAMEMASTER2` = 'U'. */
  GAMEMASTER2: 0x55,
  /** Administrator — all commands. C++ `AUTH_ADMINISTRATOR` = 'V'. */
  ADMINISTRATOR: 0x56,
} as const);

export type Authority = typeof AUTH[keyof typeof AUTH];

/**
 * `IsAuthHigher` equivalent — true if `player` meets the `required` rank.
 * A GM ('T') satisfies GENERAL ('S') but not GAMEMASTER2 ('U').
 */
export function hasAuthority(player: number, required: number): boolean {
  return player >= required;
}

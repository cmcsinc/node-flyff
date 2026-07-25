/**
 * GM/admin authority ranks -- mirrors v19 `_Common/authorization.h:6-15` EXACTLY.
 *
 * C++ stores `m_dwAuthorization` per user and gates `ParsingCommand` entries
 * with `cmd.m_dwAuthorization > pMover->m_dwAuthorization => break` (ordinal
 * compare, `_Interface/FuncTextCmd.cpp:5556`). The values are ASCII bytes:
 *   AUTH_GENERAL       'F' (0x46)
 *   AUTH_GAMEMASTER    'L' (0x4C)
 *   AUTH_GAMEMASTER2   'M' (0x4D)
 *   AUTH_GAMEMASTER3   'N' (0x4E)
 *   AUTH_OPERATOR      'O' (0x4F)
 *   AUTH_ADMINISTRATOR 'P' (0x50)
 *
 * **The values MUST match C++ verbatim** -- the byte we serialize into the JOIN
 * snapshot (`mover.serializer.ts`, read back by the client into
 * `g_pPlayer->m_dwAuthorization`) is compared against the CLIENT's own
 * `AUTH_*` defines. (v15 used 'S'/'T'/'U'/'V' = 0x53-0x56; v19 switched to the
 * F/L/M/N/O/P ladder.) Ordinal order is preserved, so `hasAuthority` keeps
 * working.
 *
 * Mapping today is binary off the `accounts.gm` boolean -- GM accounts land at
 * `ADMINISTRATOR` ('P'), everyone else at `GENERAL` ('F'). ponytail: when a
 * real `account.authority` column ships, populate the intermediate tiers.
 *
 * @module constants/authority
 */

export const AUTH = Object.freeze({
  /** Player -- default. v19 `AUTH_GENERAL` = 'F'. */
  GENERAL: 0x46,
  /** GM tier 1 -- teleport/summon/invisible. v19 `AUTH_GAMEMASTER` = 'L'. */
  GAMEMASTER: 0x4c,
  /** GM tier 2 -- disconnect/notice/system. v19 `AUTH_GAMEMASTER2` = 'M'. */
  GAMEMASTER2: 0x4d,
  /** GM tier 3 -- (C++ collapses to ADMINISTRATOR today). v19 `AUTH_GAMEMASTER3` = 'N'. */
  GAMEMASTER3: 0x4e,
  /** Operator -- v19 `AUTH_OPERATOR` = 'O'. */
  OPERATOR: 0x4f,
  /** Administrator -- all commands. v19 `AUTH_ADMINISTRATOR` = 'P'. */
  ADMINISTRATOR: 0x50,
} as const);

export type Authority = typeof AUTH[keyof typeof AUTH];

/**
 * `IsAuthHigher` equivalent -- true if `player` meets the `required` rank.
 * A GM ('L') satisfies GENERAL ('F') but not GAMEMASTER2 ('M').
 */
export function hasAuthority(player: number, required: number): boolean {
  return player >= required;
}

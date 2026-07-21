/**
 * GM/admin authority ranks — mirrors `_Common/authorization.h`.
 *
 * C++ stores `m_dwAuthorization` per user and gates `ParsingCommand` entries
 * with `cmd.dwAuthorization > pMover->m_dwAuthorization ⇒ reject` (ordinal
 * compare). The original uses ASCII bytes ('F','L','P'…) but the ordering is
 * all that matters, so plain ascending ints are equivalent.
 *
 * Mapping today is binary off the `accounts.gm` boolean — GM accounts land at
 * `ADMINISTRATOR`, everyone else at `GENERAL`. ponytail: when a real
 * `account.authority` column ships, populate the intermediate tiers from the
 * DB row instead of collapsing to the top.
 *
 * @module constants/authority
 */

export const AUTH = Object.freeze({
  /** Player — default. Maps to C++ `AUTH_GENERAL`. */
  GENERAL: 0,
  /** GM tier 1 — teleport/summon/invisible. C++ `AUTH_GAMEMASTER`. */
  GAMEMASTER: 1,
  /** GM tier 2 — disconnect/notice/system. C++ `AUTH_GAMEMASTER2`. */
  GAMEMASTER2: 2,
  /** Administrator — all commands. C++ `AUTH_ADMINISTRATOR`. */
  ADMINISTRATOR: 3,
} as const);

export type Authority = typeof AUTH[keyof typeof AUTH];

/**
 * `IsAuthHigher` equivalent — true if `player` meets the `required` rank.
 * A GM (1) satisfies GENERAL (0) but not GAMEMASTER2 (2).
 */
export function hasAuthority(player: number, required: number): boolean {
  return player >= required;
}

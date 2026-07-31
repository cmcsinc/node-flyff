/**
 * Friend-roster constants -- `_Common/messenger.h:6-20`.
 *
 * v19 compiles `__RT_1025` (`WORLDSERVER/VersionCommon.h:127`), so the live
 * roster is `CRTMessenger` (`map<u_long, Friend>`), not the legacy `CMessenger`.
 * Two consequences worth stating because they change the wire format:
 *  - `SNAPSHOTTYPE_ADDFRIEND` carries NO job/sex fields (those are inside the
 *    `#ifndef __RT_1025` branch of `CUser::AddAddFriend`, `User.cpp:1625`).
 *  - Blocking is NOT a state value under `__RT_1025`; it is the separate
 *    `Friend::bBlock` flag. A blocked friend is reported to the blocker's peers
 *    as `FRS_OFFLINE` (`CORESERVER/DPCacheSrvr.cpp:340`).
 *
 * @module social/constants/friend
 */

/**
 * `FRS_*` presence states (`messenger.h:6-18`). A plain enum in a DWORD, not a
 * bitfield -- `OnSetFrinedState` (`DPCacheSrvr.cpp:2086`) does no range check on
 * the client-supplied value, so we clamp to `< MAX_FRIENDSTAT` (rule 03).
 */
export const FRS = Object.freeze({
  ONLINE: 0,
  OFFLINE: 1,
  BLOCK: 2,
  ABSENT: 3,
  HARDPLAY: 4,
  EAT: 5,
  REST: 6,
  MOVE: 7,
  DIE: 8,
  DANGER: 9,
  OFFLINEBLOCK: 10,
  /** Auto-away. NOT relayed to peers (`DPCacheSrvr.cpp:2091` skips the fan-out). */
  AUTOABSENT: 11,
} as const);

/** `MAX_FRIENDSTAT` (`messenger.h:18`) -- exclusive upper bound for `FRS_*`. */
export const MAX_FRIENDSTAT = 12;

/**
 * `uIdofMulti` placeholder for an offline friend (`DPCacheSrvr.cpp:363` sends
 * the literal `100`). It is the multi-server id; with one world process the
 * value is cosmetic, but the field must be present or the client's read shifts.
 */
export const OFFLINE_ID_OF_MULTI = 100;

/**
 * `AddFriendError` codes (`WORLDSERVER/DPSrvr.cpp:1598/1604`), sent as a BYTE.
 * `1` = already on the roster, `2` = no character by that name.
 */
export const FRIEND_ERROR = Object.freeze({
  ALREADY_FRIEND: 1,
  NAME_NOT_FOUND: 2,
} as const);

/** `TID_GAME_BATTLE_NOTFRIEND` -- target took damage in the last 10 s. */
export const TID_GAME_BATTLE_NOTFRIEND = 1925;

/**
 * STATEMODE S->C snapshot -- the item-channel (cast-bar) state broadcast.
 *
 * `CUserMng::AddStateMode` (`WORLDSERVER/User.cpp:5144`):
 * ```
 * ar << GETID( pUser ) << SNAPSHOTTYPE_STATEMODE;  // 0x00df
 * ar << pUser->m_dwStateMode;                      // DWORD
 * ar << nFlag;                                     // BYTE
 * if( nFlag == STATEMODE_BASEMOTION_ON )
 *     ar << pItemProp->dwID;                       // DWORD -- only on ON
 * ```
 * Broadcast to the caster's visibility range (`FOR_VISIBILITYRANGE`) so peers
 * see the cast bar and the ready sfx too.
 *
 * Client `CDPClient::OnStateMode` (`Neuz/DPClient.cpp:12412`) assigns
 * `m_dwStateMode` verbatim, and on `ON` spawns `dwSfxObj` from the item prop
 * (`XI_BLINKWING_READY`) and starts the local cast bar off `dwSkillReadyType`
 * (`MoverRender.cpp:2081`). The trailing item id is read ONLY for `ON` -- send
 * it on `OFF`/`CANCEL` and the client over-reads the frame.
 *
 * @module serializers/stateMode
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID, SNAPSHOTTYPE_STATEMODE } from '../snapshot-constants';

/** `CMover::m_dwStateMode` bits (`_Common/authorization.h:60-64`). */
export const STATE_BASEMOTION_MODE = 0x00000004;

/** `nFlag` values (`_Common/authorization.h:68-70`). */
export const STATEMODE = Object.freeze({
  /** Channel started -- payload carries the item id. */
  BASEMOTION_ON: 0x00,
  /** Channel completed normally. */
  BASEMOTION_OFF: 0x01,
  /** Channel aborted (moved, hit, cancelled). */
  BASEMOTION_CANCEL: 0x02,
} as const);

/**
 * `objid | 0x00df | DWORD stateMode | BYTE flag [| DWORD itemId]`.
 *
 * @param stateMode - the caster's post-transition `m_dwStateMode` bitmask
 * @param flag - one of {@link STATEMODE}
 * @param itemId - item prop id; REQUIRED for `BASEMOTION_ON`, ignored otherwise
 */
export function buildStateMode(objid: number, stateMode: number, flag: number, itemId?: number): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(NULL_ID);
  w.writeWord(1);
  w.writeDword(objid);
  w.writeWord(SNAPSHOTTYPE_STATEMODE);
  w.writeDword(stateMode);
  w.writeByte(flag);
  if (flag === STATEMODE.BASEMOTION_ON) w.writeDword(itemId ?? 0);
  return w.build();
}

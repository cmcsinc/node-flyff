/**
 * QUERYGETPOS S->C snapshot -- "report your position".
 *
 * `CUser::AddQueryGetPos` (`WORLDSERVER/User.cpp:2352`):
 * ```
 * ar << GetId();
 * ar << SNAPSHOTTYPE_QUERYGETPOS;   // 0x001b
 * ar << idFrom;                     // NULL_ID when the server itself asks
 * ```
 * The client's `CDPClient::OnQueryGetPos` (`Neuz/DPClient.cpp:9000`) answers with
 * `PACKETTYPE_GETPOS` (`vPos | fAngle | objid`), echoing `idFrom` as `objid`.
 * With `NULL_ID` the server's `OnGetPos` (`DPSrvr.cpp:1463`) takes the position
 * as authoritative for that player and clears `m_fWaitQueryGetPos`.
 *
 * C++ uses this whenever the server is NOT the authority for a mover that has a
 * pending destination (`CMover::OnActDrop`/`OnActCollision`,
 * `MoverActEvent.cpp:2015`). This emulator is client-authoritative for player
 * position, so it is also how a walk-to-ground-item arrival is detected -- the
 * client sends no movement packets while auto-walking to a dest object.
 *
 * @module serializers/queryGetPos
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID, SNAPSHOTTYPE_QUERYGETPOS } from '../snapshot-constants';

/** `objid | 0x001b | idFrom`, wrapped in a single-entry snapshot frame. */
export function buildQueryGetPos(objid: number, idFrom: number = NULL_ID): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(NULL_ID);
  w.writeWord(1);
  w.writeDword(objid);
  w.writeWord(SNAPSHOTTYPE_QUERYGETPOS);
  w.writeDword(idFrom);
  return w.build();
}

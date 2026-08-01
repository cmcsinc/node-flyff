/**
 * Navigator map-ping snapshot -- `SNAPSHOTTYPE_SETNAVIPOINT` (0x00c6,
 * `_Network/MsgHdr.h:1121`).
 *
 * Mirrors `CUser::AddSetNaviPoint` (`WORLDSERVER/User.cpp:2559`):
 *   `m_Snapshot.ar << objid << SNAPSHOTTYPE_SETNAVIPOINT << nv.Pos` then
 *   `WriteString( Name )`. `nv.On` is commented out in C++ -- do NOT write it.
 *
 * The record `objid` is the **pinger's** player objid, not the recipient's --
 * unlike every other per-user snapshot in this codebase. `CDPClient::
 * OnSetNaviPoint` (`Neuz/DPClient.cpp:15358`) uses it as the dedupe key for
 * `g_pPlayer->m_vOtherPoint` (max 10 entries, `Time = 200` ticks) so one
 * pinger's repeated pings replace their own marker instead of stacking.
 *
 * `nv.Pos` is a `D3DXVECTOR3` -- three LE floats, world coords (x, y, z). The
 * client only fills x/z from the minimap click; y stays 0.
 *
 * @module serializers/naviPoint
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID } from '../snapshot-constants';

/**
 * `SNAPSHOTTYPE_SETNAVIPOINT` -- one navigator marker.
 *
 * @param pingerObjid - The pinging player's objid (the client's dedupe key).
 * @param pos - Ping world position (`nv.Pos`).
 * @param name - Pinger's display name (`CMover::GetName( TRUE )`).
 */
export function buildSetNaviPoint(
  pingerObjid: number,
  pos: { x: number; y: number; z: number },
  name: string,
): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(NULL_ID);
  w.writeWord(1);
  w.writeDword(pingerObjid);
  w.writeWord(SNAPSHOTTYPE.SETNAVIPOINT);
  w.writeFloat(pos.x);
  w.writeFloat(pos.y);
  w.writeFloat(pos.z);
  w.writeString(name);
  return w.build();
}

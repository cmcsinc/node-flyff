/**
 * S->C cheer snapshots -- `SNAPSHOTTYPE_SETCHEERPARAM` (0x00b4) and
 * `SNAPSHOTTYPE_CREATESFXOBJ` (0x000f).
 *
 * `CUser::AddSetCheerParam` (`WORLDSERVER/User.cpp:2622`):
 *   m_Snapshot.ar << GETID( this );
 *   m_Snapshot.ar << SNAPSHOTTYPE_SETCHEERPARAM;
 *   m_Snapshot.ar << nCheerPoint << dwRest;    // int, DWORD
 *   m_Snapshot.ar << bAdd;                     // BOOL (int, 4 B)
 * Self-only. `bAdd` is TRUE only when the point count went UP (regen) --
 * `CMover::SetCheerParam` (`Mover.cpp:9080`) derives it as
 * `m_nCheerPoint < nCheerPoint`, and the client shows `TID_CHEER_MESSAGE5`
 * ("cheer point recovered") only in that case. Spending sends it FALSE.
 * `dwRest` is the remaining ms until the next point, not an absolute deadline.
 *
 * `CUserMng::AddCreateSfxObj` (`WORLDSERVER/User.cpp:5012`):
 *   ar << GETID( pCtrl ) << SNAPSHOTTYPE_CREATESFXOBJ;
 *   ar << dwSfxObj << x << y << z;             // DWORD, 3x float
 *   ar << bFlag;                               // BOOL (int, 4 B)
 * Broadcast to the visibility range INCLUDING the origin mover (no USERPTR
 * skip, unlike the movement broadcasts). The default overload
 * (`User.h:896`) passes x = y = z = 0 and bFlag = FALSE -- the cheer path uses
 * exactly that form, so the client anchors the effect on the mover itself.
 *
 * @module net/snapshot/cheer.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID } from '@flyff/world-core';

/**
 * Build SETCHEERPARAM for `objid`.
 *
 * @param cheerPoint  points held AFTER the change (0..MAX_CHEERPOINT)
 * @param restMs      ms until the next point accrues
 * @param added       TRUE only on regen (point count went up)
 */
export function buildSetCheerParam(
  objid: number, cheerPoint: number, restMs: number, added: boolean,
): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(NULL_ID);
  w.writeWord(1);
  w.writeDword(objid);
  w.writeWord(SNAPSHOTTYPE.SETCHEERPARAM);
  w.writeDword(cheerPoint);
  w.writeDword(Math.max(0, Math.floor(restMs)));
  w.writeDword(added ? 1 : 0);   // BOOL
  return w.build();
}

/**
 * Build CREATESFXOBJ for `objid`. Positions default to 0 (mover-anchored),
 * matching the 2-arg C++ call the cheer path uses.
 */
export function buildCreateSfxObj(
  objid: number, sfxObjId: number,
  pos: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
  flag = false,
): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(NULL_ID);
  w.writeWord(1);
  w.writeDword(objid);
  w.writeWord(SNAPSHOTTYPE.CREATESFXOBJ);
  w.writeDword(sfxObjId);
  w.writeFloat(pos.x);
  w.writeFloat(pos.y);
  w.writeFloat(pos.z);
  w.writeDword(flag ? 1 : 0);    // BOOL
  return w.build();
}

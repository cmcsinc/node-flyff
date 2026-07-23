/**
 * S->C disguise transform -- `SNAPSHOTTYPE_DISGUISE` (0x00f5) / `NODISGUISE` (0x00f6).
 *
 * Mirrors `CUserMng::AddDisguise` / `AddNoDisguise` (`WORLDSERVER/User.cpp:4455`
 * / 4466):
 *   Disguise    ar << GETID(pMover) << SNAPSHOTTYPE_DISGUISE << dwMoverIdx;
 *   NoDisguise  ar << GETID(pMover) << SNAPSHOTTYPE_NODISGUISE;
 *
 * Set by `/dis <moverId>` (`TextCmd_Disguise`, FuncTextCmd.cpp:3159) so peers
 * render the player as that propMover model; `/nodis` (TextCmd_NoDisguise:3139)
 * clears it. Broadcast fan-out is the caller's job (`playerManager.broadcastAll`).
 *
 * @module net/snapshot/disguise.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID, SNAPSHOTTYPE_DISGUISE, SNAPSHOTTYPE_NODISGUISE } from './constants';

export class DisguiseSerializer {
  /** `AddDisguise` -- render the mover as propMover `dwMoverIdx`. */
  build(objid: number, dwMoverIdx: number): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);
    w.writeWord(1);
    w.writeDword(objid);
    w.writeWord(SNAPSHOTTYPE_DISGUISE);
    w.writeDword(dwMoverIdx);
    return w.build();
  }

  /** `AddNoDisguise` -- clear a prior disguise (bodyless). */
  buildClear(objid: number): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);
    w.writeWord(1);
    w.writeDword(objid);
    w.writeWord(SNAPSHOTTYPE_NODISGUISE);
    return w.build();
  }
}

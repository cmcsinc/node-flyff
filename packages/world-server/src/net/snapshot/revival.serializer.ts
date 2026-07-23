/**
 * S->C REVIVAL confirm snapshots -- `SNAPSHOTTYPE_REVIVAL*`
 * (`_Network/MsgHdr.h:1044-1046`).
 *
 * Mirrors `CUserMng::AddRevival`-style `AddHdr` (`WORLDSERVER/User.cpp:5400`):
 * the body is just the `AddHdr` prefix -- `OBJID objid + WORD wHdr` -- with **no
 * per-type fields**. The `wHdr` (snapshot sub-type) alone distinguishes scroll /
 * town / lodelight. Vicinity broadcast (peers see the revive motion). The dying
 * player's own client applies HP/MP/FP restore off the follow-up
 * SETEXPERIENCE/SETPOINTPARAM frames, not off this snapshot
 * (`Neuz/DPClient.cpp:3384/3418/3449` -> `ClearState()`).
 *
 * One serializer serves all three sub-types -- pass the desired
 * `SNAPSHOTTYPE_REVIVAL*` constant.
 *
 * @module net/snapshot/revival.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID } from '@flyff/world-core';

export class RevivalSerializer {
  /**
   * @param objid       reviving player's object id (`GETID(pUser)`)
   * @param snapshotType one of `SNAPSHOTTYPE_REVIVAL` / `_TO_LODESTAR` / `_TO_LODELIGHT`
   */
  build(objid: number, snapshotType: number): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);
    w.writeWord(1);
    w.writeDword(objid);
    w.writeWord(snapshotType);
    return w.build();
  }
}

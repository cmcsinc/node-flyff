/**
 * S->C ACTMSG snapshot -- generic state/motion message (`SNAPSHOTTYPE_ACTMSG`,
 * 0x0002). Mirrors `CUserMng::AddActMsg` (`WORLDSERVER/User.cpp`). Used in
 * `DoDie` (`_Common/Mover.cpp:5204-5205`) to send `OBJMSG_STOP` (halt) and
 * `OBJMSG_DIE` (open revive dialog) to the dying player.
 *
 * Wire (after the SNAPSHOT frame prefix):
 *  dwMsg:DWORD  -- the `OBJMSG_*` enum value
 *  dwParam:DWORD  -- context-dependent (0 for simple messages)
 *  idAttacker:DWORD  -- mover that caused the message (or 0)
 *
 * @module net/snapshot/actMsg.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID } from '@flyff/world-core';

export class ActMsgSerializer {
  build(objid: number, dwMsg: number, dwParam: number, idAttacker: number): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(NULL_ID);
  w.writeWord(1);
  w.writeDword(objid);
  w.writeWord(SNAPSHOTTYPE.ACTMSG);
  w.writeDword(dwMsg);
  w.writeDword(dwParam);
  w.writeDword(idAttacker);
  return w.build();
  }

  /**
   * `CUserMng::AddMotion` (`User.cpp:4392`) -- `SNAPSHOTTYPE_MOTION` (0x0098):
   * `[objid][0x0098][dwMsg]`, broadcast to the visibility range incl. self. The
   * client's `OnMotion` (DPClient.cpp:9813) re-dispatches `dwMsg` as
   * `SendActMsg`, so `OBJMSG_PICKUP` plays the bend-down anim + pickup sound.
   * Unlike {@link build} (ACTMSG, 3 trailing DWORDs), MOTION carries only dwMsg.
   */
  buildMotion(objid: number, dwMsg: number): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);
    w.writeWord(1);
    w.writeDword(objid);
    w.writeWord(SNAPSHOTTYPE.MOTION);
    w.writeDword(dwMsg);
    return w.build();
  }
}

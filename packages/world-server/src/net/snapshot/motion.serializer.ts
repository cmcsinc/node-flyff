/**
 * S->C MOTION broadcast -- `SNAPSHOTTYPE_MOTION` (0x0098) inside a SNAPSHOT frame.
 *
 * Mirrors `CUserMng::AddMotion` (`WORLDSERVER/User.cpp`):
 *   ar << GETID(pUser) << SNAPSHOTTYPE_MOTION << dwMsg;
 *
 * Wire layout (after the outer SNAPSHOT/NULL_ID/count/objid/word preamble):
 *   dwMsg:DWORD
 *
 * `dwMsg` is an `OBJMSG_*` enum value (stand up, sit down, etc.) -- see
 * `_Common/Obj.h`. The server echoes it verbatim; client plays the animation.
 *
 * @module net/snapshot/motion.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import { NULL_ID, SNAPSHOTTYPE_MOTION } from './constants.js';

export class MotionSerializer {
  build(speakerObjid: number, dwMsg: number): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);
    w.writeWord(1);
    w.writeDword(speakerObjid);
    w.writeWord(SNAPSHOTTYPE_MOTION);
    w.writeDword(dwMsg);
    return w.build();
  }
}

/**
 * S->C MOVER_DEATH snapshot -- `SNAPSHOTTYPE_MOVERDEATH` (0x00c7).
 *
 * Mirrors `CUserMng::AddMoverDeath` (`WORLDSERVER/User.cpp:4488`):
 *   ar << GETID(pMover) << SNAPSHOTTYPE_MOVER_DEATH;
 *   ar << idAttacker << dwMsg;
 *
 * Vicinity broadcast. Client zeroes HP locally + plays the death animation
 * (`DPClient.cpp:1902`). `dwMsg` is an `OBJMSG_*` kill-type flag (0 = generic
 * PvE death for v1).
 *
 * @module net/snapshot/moverDeath.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import { SNAPSHOTTYPE_MOVERDEATH, NULL_ID } from './constants.js';

export class MoverDeathSerializer {
  build(victimObjid: number, killerObjid: number, dwMsg: number): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);
    w.writeWord(1);
    w.writeDword(victimObjid);
    w.writeWord(SNAPSHOTTYPE_MOVERDEATH);
    w.writeDword(killerObjid);
    w.writeDword(dwMsg);
    return w.build();
  }
}

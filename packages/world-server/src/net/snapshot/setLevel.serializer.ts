/**
 * S->C SETLEVEL snapshot -- `SNAPSHOTTYPE_SETLEVEL` (0x0011).
 *
 * Mirrors `CUser::AddSetLevel` (`WORLDSERVER/User.cpp:4655`):
 *   ar << GETID(pMover) << SNAPSHOTTYPE_SETLEVEL;
 *   ar << wLevel;
 *
 * Vicinity broadcast, **skips self** -- the leveling player gets their new level
 * via SETEXPERIENCE instead. Peers play the level-up SFX + HP/MP refill
 * (`DPClient.cpp:3273`).
 *
 * @module net/snapshot/setLevel.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { SNAPSHOTTYPE_SETLEVEL, NULL_ID } from './constants';

export class SetLevelSerializer {
  build(moverObjid: number, level: number): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);
    w.writeWord(1);
    w.writeDword(moverObjid);
    w.writeWord(SNAPSHOTTYPE_SETLEVEL);
    w.writeWord(level & 0xffff);
    return w.build();
  }
}

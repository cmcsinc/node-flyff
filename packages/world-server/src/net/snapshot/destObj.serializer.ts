/**
 * S->C MOVERSETDESTOBJ broadcast -- "player is walking toward object X" echo.
 *
 * Mirrors `CUserMng::AddMoverSetDestObj` (`WORLDSERVER/User.cpp:4754-4767`):
 *   ar << GETID( pMover ) << SNAPSHOTTYPE_MOVERSETDESTOBJ;
 *   ar << objid << fRange;
 *
 * Peer clients run their own pathfinding to the object (`CDPClient::OnMoverSetDestObj`
 * -> `CMover::SetDestObj`, Neuz/DPClient.cpp:8431) -- the server sends NO position,
 * only the destination obj id + stop range. Sender is excluded by `fTransferToMe=FALSE`.
 *
 * @module net/snapshot/destObj.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import { SNAPSHOTTYPE_MOVERSETDESTOBJ, SNAPSHOTTYPE_GETDESTOBJ, NULL_ID } from './constants.js';

export class DestObjSerializer {
  /** Build the SNAPSHOT/MOVERSETDESTOBJ broadcast payload for `senderObjid`. */
  build(senderObjid: number, destObjid: number, fRange: number): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);        // 0xffffff00
    w.writeDword(NULL_ID);                    // objidPlayer -- unused client-side
    w.writeWord(1);                           // cb = 1 entry
    w.writeDword(senderObjid);                // GETID(pMover) -- the walking player
    w.writeWord(SNAPSHOTTYPE_MOVERSETDESTOBJ);// 0x00c2
    w.writeDword(destObjid);                  // destination object id
    w.writeFloat(fRange);                     // stop-range
    return w.build();
  }

  /**
   * Build the SNAPSHOT/GETDESTOBJ self-reply for QUERYGETDESTOBJ. Mirrors
   * `CUser::AddGetDestObj` (`WORLDSERVER/User.cpp:2337`): one per-user snapshot
   * entry `OBJID mover | 0x004a | OBJID dest | FLOAT fRange`. Written only when
   * the mover has a destination (`IsEmptyDestObj()` == false).
   */
  buildGetDestObj(queriedObjid: number, destObjid: number, fRange: number): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);      // 0xffffff00
    w.writeDword(NULL_ID);                  // objidPlayer -- unused client-side
    w.writeWord(1);                         // cb = 1 entry
    w.writeDword(queriedObjid);             // the mover being asked about
    w.writeWord(SNAPSHOTTYPE_GETDESTOBJ);   // 0x004a
    w.writeDword(destObjid);                // mover's destination object id
    w.writeFloat(fRange);                   // arrival / stop range
    return w.build();
  }
}

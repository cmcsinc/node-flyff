/**
 * S->C same-world teleport -- `SNAPSHOTTYPE_SETPOS` (0x0010).
 *
 * Mirrors `CUserMng::AddSetPos` (`WORLDSERVER/User.cpp:4640`):
 *   ar << GETID( pCtrl ) << SNAPSHOTTYPE_SETPOS;
 *   ar << vPos;
 *
 * Client `CDPClient::OnSetPos` (`Neuz/DPClient.cpp:2152`) relocates the active
 * obj (the local player): `ReadWorld(vPos, TRUE)` + `SetPos` + `AddObj` + camera
 * move -- it NEVER nulls `g_pPlayer`. This is the C++ same-world teleport path
 * (`CWorld::_replace`, `World.cpp:1589-1604`), used in lieu of REPLACE for
 * in-world revivals.
 *
 * `REPLACE` (`OnReplace`, `DPClient.cpp:2352`) sets `g_pPlayer = NULL` and only
 * restores it when the server re-sends the player's own ADD_OBJ afterward
 * (`_replace` cross-world branch, `World.cpp:1640-1645`). Our revival never
 * re-sends self ADD_OBJ, so a same-world REPLACE left `g_pPlayer` null and the
 * first ticking window (`CWndQuestQuickInfo::Process:259`) crashed. SETPOS
 * avoids the null entirely.
 *
 * Same wire frame as `DestPosSerializer`:
 *   [SNAPSHOT:DWORD][objidPlayer:DWORD][cb:WORD][ [objid:DWORD][hdr:WORD][body] ]
 *
 * @module net/snapshot/setPos.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import type { Vec3 } from '../../entities/player';
import { SNAPSHOTTYPE_SETPOS, NULL_ID } from './constants';

export class SetPosSerializer {
  /** Build the SNAPSHOT/SETPOS payload for `objid` teleporting to `pos`. */
  build(objid: number, pos: Vec3): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);       // 0xffffff00
    w.writeDword(NULL_ID);                    // objidPlayer -- unused client-side
    w.writeWord(1);                           // cb = 1 entry
    w.writeDword(objid);                      // GETID(pCtrl)
    w.writeWord(SNAPSHOTTYPE_SETPOS);         // 0x0010
    w.writeFloat(pos.x);
    w.writeFloat(pos.y);
    w.writeFloat(pos.z);
    return w.build();
  }
}

/**
 * Player self-spawn frame: JOIN (0xff00) wrapping one SNAPSHOT ADD_OBJ entry.
 *
 * Wire layout (payload -- the dispatcher adds the 0x5E + size framing):
 *   [JOIN:DWORD]                       dwHdr
 *   [objidPlayer:DWORD]                recipient's own objid
 *   [cb:WORD] = 1                      one snapshot entry
 *   entry:
 *     [objid:DWORD]                    player objid
 *     [hdr:WORD] = SNAPSHOTTYPE_ADD_OBJ
 *     [dwObjType:BYTE] = OT_MOVER      (AddAddObj explicit)
 *     [dwObjIndex:DWORD]               gender model index (MI_MALE/FEMALE)
 *     CObj::Serialize: [m_dwType:BYTE][m_dwIndex:DWORD][scale:WORD][pos:3*f][angle:WORD]
 *     CCtrl::Serialize: [m_objid:DWORD]
 *     CMover::Serialize (mover.serializer)
 *
 * Mirrors `WORLDSERVER/Snapshot.cpp:20` (SetSnapshot) + `User.cpp:308` (Open)
 * + `User.cpp:657` (AddAddObj). The CObj `m_dwType`/`m_dwIndex` are deliberate
 * duplicates of the ADD_OBJ prefix bytes (confirmed by client parse at
 * `Neuz/DPClient.cpp:1027`).
 *
 * @module net/snapshot/playerSnapshot.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import type { CPlayer } from '../../entities/player';
import {
  SNAPSHOTTYPE_ADD_OBJ, SNAPSHOTTYPE_WORLD_READINFO, WI_WORLD_MADRIGAL,
  OT_MOVER, MI_MALE, MI_FEMALE, METHOD_NONE,
} from './constants';
import { writeMoverSerialize } from './mover.serializer';

export class PlayerSnapshotSerializer {
  /** Build the JOIN self-spawn payload for `player`. */
  build(player: CPlayer): Buffer {
    const w = new PacketWriter();
    const modelIndex = player.m_nSex !== 0 ? MI_FEMALE : MI_MALE;

    // Frame header
    w.writeDword(PACKETTYPE.JOIN);     // dwHdr
    w.writeDword(player.m_idPlayer);   // objidPlayer
    w.writeWord(2);                    // cb = 2 sub-records (WORLD_READINFO + ADD_OBJ)

    // WORLD_READINFO -- loads the .wld + sets g_pWorld client-side. MUST precede
    // ADD_OBJ or OnAddObj->OpenField derefs a null CWorld (User.cpp:317).
    w.writeDword(player.m_idPlayer);         // objid (GetId)
    w.writeWord(SNAPSHOTTYPE_WORLD_READINFO); // hdr
    w.writeDword(WI_WORLD_MADRIGAL);         // dwWorldId
    w.writeFloat(player.m_vPos.x);           // vPos
    w.writeFloat(player.m_vPos.y);
    w.writeFloat(player.m_vPos.z);

    // ADD_OBJ entry header
    w.writeDword(player.m_idPlayer);   // objid
    w.writeWord(SNAPSHOTTYPE_ADD_OBJ); // hdr
    w.writeByte(OT_MOVER);             // dwObjType (AddAddObj)
    w.writeDword(modelIndex);          // dwObjIndex

    // CObj::Serialize -- m_dwType/m_dwIndex duplicate the ADD_OBJ prefix
    w.writeByte(OT_MOVER);             // m_dwType
    w.writeDword(modelIndex);          // m_dwIndex
    w.writeWord(100);                  // m_vScale.x * 100 (scale 1.0)
    w.writeFloat(player.m_vPos.x);     // m_vPos
    w.writeFloat(player.m_vPos.y);
    w.writeFloat(player.m_vPos.z);
    w.writeWord(0);                    // m_fAngle * 10 (0)

    // CCtrl::Serialize
    w.writeDword(player.m_idPlayer);   // m_objid

    // CMover::Serialize (METHOD_NONE self-spawn)
    void METHOD_NONE;
    writeMoverSerialize(w, player);

    return w.build();
  }
}

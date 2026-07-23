/**
 * NPC ADD_OBJ snapshot -- `METHOD_EXCLUDE_ITEM` non-player spawn frame.
 *
 * Wire layout (one SNAPSHOT packet wrapping N ADD_OBJ entries; the dispatcher
 * adds the 0x5E + size framing around the built payload):
 *   [SNAPSHOT:DWORD]                   dwHdr (`PACKETTYPE.SNAPSHOT` = 0xffffff00)
 *   [objidPlayer:DWORD] = NULL_ID      unused client-side (DPClient.cpp:340)
 *   [cb:WORD] = N                      entry count
 *   per entry (CUser::AddAddObj, User.cpp:657 + CMover::Serialize NPC branch):
 *     [objid:DWORD]                    pCtrl->GetId()
 *     [hdr:WORD] = SNAPSHOTTYPE_ADD_OBJ
 *     [dwObjType:BYTE] = OT_MOVER      (BYTE)pCtrl->GetType()
 *     [dwObjIndex:DWORD]               pCtrl->GetIndex()  -- MI_* propMover row
 *     CObj::Serialize (ObjSerializeOpt.cpp:18):
 *       [m_dwType:BYTE] = OT_MOVER     deliberate duplicate of prefix byte
 *       [m_dwIndex:DWORD]              duplicate of dwObjIndex
 *       [m_vScale.x*100:WORD] = 100    scale 1.0
 *       [m_vPos:3*float]
 *       [m_fAngle*10:short]
 *     CCtrl::Serialize (ObjSerialize.cpp:15):
 *       [m_objid:DWORD]                == entry objid
 *     CMover::Serialize prefix (ObjSerializeOpt.cpp:104-112, always written):
 *       [m_dwMotion:WORD] = 0
 *       [m_bPlayer:BYTE] = 0           -> routes to the NPC `else` branch
 *       [m_nHitPoint:DWORD]
 *       [GetState():DWORD] = 0
 *       [GetStateFlag():DWORD] = 0
 *       [m_dwBelligerence:BYTE]
 *       [m_dwMoverSfxId:DWORD] = 0     __VER>=15
 *     CMover::Serialize NPC branch (ObjSerializeOpt.cpp:319-352):
 *       [m_dwHairMesh:BYTE][m_dwHairColor:DWORD][m_dwHeadMesh:BYTE]
 *       [m_szCharacterKey:String]      DWORD len + bytes (empty for monsters)
 *       [uSize:BYTE] = 0               equipment part count (no equip -> 0)
 *       [m_bActiveAttack:BYTE]
 *       [m_nMovePattern:BYTE] = 0
 *       [m_nMoveEvent:BYTE] = 0
 *       [m_nMoveEventCnt:DWORD] = 0
 *       [m_fSpeedFactor:float]         __VER>=9
 *     CBuffMgr (always, __BUFF_1107):
 *       [count:DWORD] = 0
 *
 * `CObj::SetMethod(METHOD_EXCLUDE_ITEM)` (User.cpp:670) selects this short
 * path for any non-self mover; the player's own JOIN uses METHOD_NONE via
 * `playerSnapshot.serializer` instead.
 *
 * Equipment loop (`uSize` + per-part `{uParts, m_dwItemId}`) is wired from
 * `outfit.equip`; monsters and AddMenu-only NPCs send `uSize=0`.
 *
 * @module net/snapshot/npcSnapshot.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import type { CMover, MoverEquipPart } from '@flyff/entities';
import {
  SNAPSHOTTYPE_ADD_OBJ, OT_MOVER, NULL_ID,
} from '@flyff/world-core';

export class NpcSnapshotSerializer {
  /** Build the SNAPSHOT/ADD_OBJ payload for a batch of NPC movers. */
  build(movers: readonly CMover[]): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);   // dwHdr
    w.writeDword(NULL_ID);               // objidPlayer -- unused
    w.writeWord(movers.length);          // cb

    for (const m of movers) {
      this.writeAddObj(w, m);
    }
    return w.build();
  }

  /** Write one ADD_OBJ entry for `mover` (NPC branch). */
  private writeAddObj(w: PacketWriter, m: CMover): void {
    // ADD_OBJ prefix
    w.writeDword(m.m_idMover);           // objid
    w.writeWord(SNAPSHOTTYPE_ADD_OBJ);   // hdr
    w.writeByte(OT_MOVER);               // dwObjType
    w.writeDword(m.m_dwIndex);           // dwObjIndex

    // CObj::Serialize
    w.writeByte(OT_MOVER);               // m_dwType (duplicate)
    w.writeDword(m.m_dwIndex);           // m_dwIndex (duplicate)
    w.writeWord(Math.max(0, Math.min(0xFFFF, Math.round(m.m_vScale * 100)))); // m_vScale.x*100
    w.writeFloat(m.m_vPos.x);            // m_vPos
    w.writeFloat(m.m_vPos.y);
    w.writeFloat(m.m_vPos.z);
    w.writeWord(Math.round(m.m_fAngle * 10) & 0xFFFF); // m_fAngle * 10 (short, byte-exact as u_short)

    // CCtrl::Serialize
    w.writeDword(m.m_idMover);           // m_objid

    // CMover::Serialize prefix (always written)
    w.writeWord(0);                      // m_dwMotion
    w.writeByte(0);                      // m_bPlayer (0 -> NPC branch)
    w.writeDword(m.m_nHitPoint);         // m_nHitPoint
    w.writeDword(0);                     // GetState()
    w.writeDword(0);                     // GetStateFlag()
    w.writeByte(m.m_dwBelligerence);     // m_dwBelligerence
    w.writeDword(0);                     // m_dwMoverSfxId (__VER>=15)

    // NPC branch (m_bPlayer == 0) -- ObjSerializeOpt.cpp:319-352
    const outfit = m.outfit;
    w.writeByte(outfit?.hairMesh ?? 0);  // m_dwHairMesh (u_char)
    w.writeDword(outfit?.hairColor ?? 0); // m_dwHairColor
    w.writeByte(outfit?.headMesh ?? 0);  // m_dwHeadMesh (u_char)
    // m_szCharacterKey -- the character.inc block key (e.g. "MaFl_Marche"). The
    // client uses it to look up CNpcProperty -> m_abMoverMenu (AddMenu flags) AND
    // the appearance. MUST be sent even when the NPC has no outfit (SetFigure/
    // SetEquip): an AddMenu-only NPC still needs its key or the right-click
    // "Dialog" option never appears. Monsters send an empty string.
    w.writeString(m.m_szCharacterKey || outfit?.characterKey || '');

    // Equipment parts: uSize then uSize * { uParts:BYTE, m_dwItemId:WORD }
    const equip = outfit?.equip ?? EMPTY_EQUIP;
    w.writeByte(equip.length);           // uSize
    for (const part of equip) {
      w.writeByte(part.parts);           // uParts
      w.writeWord(part.itemId);          // m_dwItemId (u_short)
    }

    w.writeByte(m.m_bActiveAttack);      // m_bActiveAttack
    w.writeByte(0);                      // m_nMovePattern
    w.writeByte(0);                      // m_nMoveEvent
    w.writeDword(0);                     // m_nMoveEventCnt
    w.writeFloat(m.m_fSpeedFactor);      // m_fSpeedFactor (__VER>=9)

    // CBuffMgr (__BUFF_1107)
    w.writeDword(0);                     // buff count
  }
}

const EMPTY_EQUIP: readonly MoverEquipPart[] = Object.freeze([]);

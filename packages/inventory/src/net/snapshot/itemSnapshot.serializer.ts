/**
 * Ground-item ADD_OBJ snapshot -- `OT_ITEM` (4) spawn frame for dropped `CItem`s.
 *
 * Wire layout (one SNAPSHOT wrapping N ADD_OBJ entries; the dispatcher adds the
 * 0x5E + size framing). Sources: `CItem::Serialize` (ObjSerialize.cpp:158) ->
 * `CCtrl::Serialize` (:15) -> `CObj::Serialize` (ObjSerializeOpt.cpp:18) for the
 * object frame; then `CItemBase::Serialize` (ObjSerialize.cpp:31) + `CItemElem
 * ::Serialize` (:48). Empty-drop values verified against the C++ store branch.
 *
 * Per entry:
 *   ADD_OBJ prefix (CUser::AddAddObj, User.cpp:657):
 *     [objid:DWORD]
 *     [hdr:WORD] = SNAPSHOTTYPE_ADD_OBJ
 *     [dwObjType:BYTE] = OT_ITEM (4)
 *     [dwObjIndex:DWORD] = m_dwItemId   (CItem::GetProp reads GetIndex() -- Item.h:985)
 *   CObj::Serialize (21B, ObjSerializeOpt.cpp:18):
 *     [m_dwType:BYTE] = 4            deliberate duplicate of prefix byte
 *     [m_dwIndex:DWORD] = m_dwItemId  (CItem::GetProp uses this, not CItemBase id)
 *     [m_vScale.x*100:WORD] = 100
 *     [m_vPos:3*float]
 *     [m_fAngle*10:short] = 0
 *   CCtrl::Serialize (ObjSerialize.cpp:15):
 *     [m_objid:DWORD]                == entry objid
 *   CItemBase::Serialize (:31):
 *     [m_dwObjId:DWORD]              == entry objid
 *     [m_dwItemId:DWORD]
 *     [m_liSerialNumber:QWORD] = 0
 *     [m_szItemText:String]          DWORD len(0) -- empty
 *   CItemElem::Serialize (:48, v19 store branch, all gates open):
 *     [m_nItemNum:short]
 *     [m_nRepairNumber:short] = 0
 *     [m_nHitPoint:int] = 0
 *     [m_nRepair:short] = 0
 *     [m_byFlag:BYTE] = 0
 *     [m_nAbilityOption:int] = 0
 *     [m_idGuild:DWORD] = 0          (u_long on wire -- low 32)
 *     [m_bItemResist:BYTE] = 0
 *     [m_nResistAbilityOption:int] = 0
 *     [m_nResistSMItemId:int] = 0
 *     piercing: [size:DWORD=0][ultSize:DWORD=0][petVisSize:DWORD=0]
 *     [m_bCharged:BYTE] = 0
 *     [m_iRandomOptItemId:QWORD] = 0   (__VER >= 11)
 *     [m_dwKeepTime:DWORD] = 0
 *     (no keepTime time_t tail -- keepTime is 0)
 *     [bPet:BYTE] = 0                  (__VER >= 9)
 *     [m_bTranformVisPet:BYTE] = 0     (__VER >= 15)
 *
 * ponytail: ability options, piercing, pet, keepTime, random opt -- all zero for
 * a vanilla drop. Populate when loot can carry upgraded items.
 *
 * @module net/snapshot/itemSnapshot
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import type { GroundItem } from '../../entities/item';
import {
  SNAPSHOTTYPE_ADD_OBJ, SNAPSHOTTYPE_DEL_OBJ, OT_ITEM,
} from '@flyff/world-core';
import { writeCItemElemBody } from '@flyff/world-core';

export class ItemSnapshotSerializer {
  /** Build the SNAPSHOT/ADD_OBJ payload for a batch of ground items. */
  build(items: readonly GroundItem[]): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);   // dwHdr
    w.writeDword(0xffffffff);            // objidPlayer -- NULL_ID, unused
    w.writeWord(items.length);           // cb

    for (const it of items) this.writeAddObj(w, it);
    return w.build();
  }

  /** `AddRemoveObj` -- bodyless `objid | DEL_OBJ`. */
  buildRemove(objid: number): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(0xffffffff);
    w.writeWord(1);
    w.writeDword(objid);
    w.writeWord(SNAPSHOTTYPE_DEL_OBJ);
    return w.build();
  }

  /** Write one ADD_OBJ entry for a ground item (OT_ITEM branch). */
  private writeAddObj(w: PacketWriter, it: GroundItem): void {
    // ADD_OBJ prefix
    w.writeDword(it.m_idObject);         // objid
    w.writeWord(SNAPSHOTTYPE_ADD_OBJ);   // hdr
    w.writeByte(OT_ITEM);                // dwObjType
    w.writeDword(it.m_dwItemId);         // dwObjIndex == propItem id (Mover.cpp:7910) -- items use CItemBase id

    // CObj (21B)
    w.writeByte(OT_ITEM);                // m_dwType
    w.writeDword(it.m_dwItemId);         // m_dwIndex -- CItem::GetProp reads this (Item.h:985)
    w.writeWord(100);                    // m_vScale.x * 100
    w.writeFloat(it.m_vPos.x);           // m_vPos
    w.writeFloat(it.m_vPos.y);
    w.writeFloat(it.m_vPos.z);
    w.writeWord(0);                      // m_fAngle * 10 (short, signed)

    // CCtrl
    w.writeDword(it.m_idObject);         // m_objid

    // CItemBase + CItemElem body (72 B) -- shared with JOIN inventory/bank +
    // CREATEITEM. m_dwObjId = the ground item's object id (same as CCtrl
    // m_objid); m_dwItemId + m_nItemNum from the drop, all upgrade fields 0.
    writeCItemElemBody(w, it.m_idObject, { itemId: it.m_dwItemId, count: it.m_nItemNum });
  }
}

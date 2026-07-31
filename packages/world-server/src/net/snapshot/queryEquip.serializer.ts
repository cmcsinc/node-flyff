/**
 * S->C QUERYEQUIP snapshot -- `SNAPSHOTTYPE_QUERYEQUIP` (0x00ac).
 *
 * Mirrors `CUser::AddQueryEquip` (`WORLDSERVER/User.cpp:2635`):
 *   m_Snapshot.ar << GETID( pUser );          // objid of the INSPECTED player
 *   m_Snapshot.ar << SNAPSHOTTYPE_QUERYEQUIP;
 *   int cbEquip = 0; m_Snapshot.ar << cbEquip;          // back-patched below
 *   for( i = 0; i < MAX_HUMAN_PARTS; i++ )
 *     if( pUser->GetEquipItem( i ) ) {
 *       ar << i;                                        // int  parts index
 *       ar << pItemElem->GetRandomOptItemId();           // __int64 (__SYS_IDENTIFY)
 *       pItemElem->SerializePiercing( ar );
 *       ar << pItemElem->m_bItemResist;                  // BYTE
 *       ar << pItemElem->m_nResistAbilityOption;         // int
 *       cbEquip++;
 *     }
 *   *(int*)( lpBlock + uOffset ) = cbEquip;             // count patched in place
 *
 * We count first and write the real prefix -- no back-patch needed.
 *
 * The packet carries **no item ids**: the client already knows the visible
 * equipment from ADD_OBJ and only wants the per-slot refine/awaken data, which
 * it stores into `aEquipInfoAdd[nParts]` (`DPClient.cpp:15781 OnQueryEquip`).
 *
 * `CPiercing::Serialize` store branch (`_Common/Piercing.cpp:35-52`) under
 * v19 (`__EXT_PIERCING` >= 12, `__PETVIS` >= 15):
 *   int  piercingSize        | DWORD piercingItem[n]
 *   int  ultimatePiercingSize| DWORD ultimatePiercingItem[n]
 *   DWORD petVisSize (size_t on the 32-bit build) | time_t visKeepTime[n]
 * We have no piercing / ultimate / pet-vis data modelled yet, so all three
 * counts go out as 0 -- a valid empty round-trip.
 * ponytail: feed real arrays once piercing/awakening ships.
 *
 * **Self-only** -- goes to the requester, not the inspected player.
 *
 * @module net/snapshot/queryEquip.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID } from '@flyff/world-core';

/** One equipped part's refine/awaken state (C++ `CItemElem` subset). */
export interface QueryEquipEntry {
  /** `PARTS_*` index, 0 <= nParts < MAX_HUMAN_PARTS. */
  readonly nParts: number;
  /** `GetRandomOptItemId()` -- awakening bitfield (`__int64`). 0 = none. */
  readonly randomOptItemId: number;
  /** `m_bItemResist` -- element type (NO_PROP=0, FIRE=1..EARTH=5). */
  readonly itemResist: number;
  /** `m_nResistAbilityOption` -- element level. */
  readonly resistAbilityOption: number;
}

export class QueryEquipSerializer {
  /**
   * @param inspectedObjid  the inspected player's objid (C++ `GETID(pUser)`)
   * @param entries         one per occupied equip part, ascending `nParts`
   */
  build(inspectedObjid: number, entries: readonly QueryEquipEntry[]): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);
    w.writeWord(1);
    w.writeDword(inspectedObjid);
    w.writeWord(SNAPSHOTTYPE.QUERYEQUIP);
    w.writeDword(entries.length);          // int cbEquip
    for (const e of entries) {
      w.writeDword(e.nParts);              // int nParts
      w.writeQword(e.randomOptItemId);     // __int64 GetRandomOptItemId
      w.writeDword(0);                     // CPiercing: piercingSize
      w.writeDword(0);                     // CPiercing: ultimatePiercingSize (__EXT_PIERCING)
      w.writeDword(0);                     // CPiercing: petVis size (__PETVIS)
      w.writeByte(e.itemResist);           // BYTE m_bItemResist
      w.writeDword(e.resistAbilityOption); // int m_nResistAbilityOption
    }
    return w.build();
  }
}

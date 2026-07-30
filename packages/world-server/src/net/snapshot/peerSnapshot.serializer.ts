/**
 * Peer-player ADD_OBJ / DEL_OBJ frames -- `METHOD_EXCLUDE_ITEM` player spawn.
 *
 * This is what a client reads when ANOTHER player walks into view. C++ builds it
 * in `CUser::AddAddObj` (`WORLDSERVER/User.cpp:657`) with
 * `CObj::SetMethod(METHOD_EXCLUDE_ITEM)` for any mover that is not the recipient,
 * driven by `CLinkMap::ModifyView` (`LinkMap.cpp:404`) as cells enter/leave the
 * viewer's visibility ring.
 *
 * Wire layout (one SNAPSHOT wrapping N entries; the dispatcher adds the 0x5E
 * frame):
 *   [SNAPSHOT:DWORD][objidPlayer:DWORD] = NULL_ID (unused)[cb:WORD] = N
 *   per entry:
 *     [objid:DWORD][hdr:WORD] = SNAPSHOTTYPE_ADD_OBJ
 *     [dwObjType:BYTE] = OT_MOVER
 *     [dwObjIndex:DWORD]  MI_MALE / MI_FEMALE
 *     CObj::Serialize: [m_dwType:BYTE][m_dwIndex:DWORD][scale:WORD][pos:3f][angle:WORD]
 *     CCtrl::Serialize: [m_objid:DWORD]
 *     CMover::Serialize METHOD_EXCLUDE_ITEM (`writeMoverExcludeItem`)
 *
 * Identical framing to `playerSnapshot.serializer` (self JOIN) except: the outer
 * opcode is SNAPSHOT not JOIN, there is no WORLD_READINFO sub-record (the peer's
 * world is already loaded), and the mover body is the short EXCLUDE_ITEM branch.
 *
 * @module net/snapshot/peerSnapshot.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import type { CPlayer } from '@flyff/entities';
import {
  SNAPSHOTTYPE_ADD_OBJ, SNAPSHOTTYPE_DEL_OBJ, OT_MOVER, MI_MALE, MI_FEMALE, NULL_ID,
} from '@flyff/world-core';
import { writeMoverExcludeItem } from './mover.serializer';

export class PeerSnapshotSerializer {
  /** Build the SNAPSHOT/ADD_OBJ payload for a batch of peer players. */
  build(players: readonly CPlayer[]): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);   // dwHdr
    w.writeDword(NULL_ID);               // objidPlayer -- unused client-side
    w.writeWord(players.length);         // cb
    for (const p of players) this.writeAddObj(w, p);
    return w.build();
  }

  /**
   * `CUser::AddRemoveObj` (`User.h:253`) -- bodyless `objid | DEL_OBJ`. Drops the
   * peer from the recipient's scene when they leave view or log out.
   */
  buildRemove(objids: readonly number[]): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);
    w.writeWord(objids.length);
    for (const objid of objids) {
      w.writeDword(objid);
      w.writeWord(SNAPSHOTTYPE_DEL_OBJ);
    }
    return w.build();
  }

  /** Write one ADD_OBJ entry for a peer player (EXCLUDE_ITEM branch). */
  private writeAddObj(w: PacketWriter, p: CPlayer): void {
    const modelIndex = p.m_nSex !== 0 ? MI_FEMALE : MI_MALE;

    w.writeDword(p.m_idPlayer);        // objid
    w.writeWord(SNAPSHOTTYPE_ADD_OBJ); // hdr
    w.writeByte(OT_MOVER);             // dwObjType
    w.writeDword(modelIndex);          // dwObjIndex

    // CObj::Serialize -- m_dwType/m_dwIndex duplicate the ADD_OBJ prefix
    w.writeByte(OT_MOVER);
    w.writeDword(modelIndex);
    w.writeWord(100);                  // m_vScale.x * 100 (scale 1.0)
    w.writeFloat(p.m_vPos.x);
    w.writeFloat(p.m_vPos.y);
    w.writeFloat(p.m_vPos.z);
    w.writeWord(Math.round(p.m_fAngle * 10) & 0xffff); // m_fAngle * 10 (short)

    // CCtrl::Serialize
    w.writeDword(p.m_idPlayer);

    writeMoverExcludeItem(w, p);
  }
}

/**
 * S->C DESTPOS broadcast -- click-to-move destination echo to zone peers.
 *
 * Mirrors `CUserMng::AddSetDestPos` (`WORLDSERVER/User.cpp:4703`):
 *   ar << GETID( pMover ) << SNAPSHOTTYPE_DESTPOS;
 *   ar << vPos << fForward;
 *   // ar << objidIAObj;  -- only `#ifdef __IAOBJ0622` (User.cpp:4714),
 *   // which is NOT defined in this v15 build, so no trailing DWORD.
 *
 * Wrapped in a SNAPSHOT packet the client dispatches in
 * `CDPClient::OnSnapshot` (`Neuz/DPClient.cpp:333`):
 *   [SNAPSHOT:DWORD][objidPlayer:DWORD][cb:WORD][ [objid:DWORD][hdr:WORD][body] ]
 *
 * `objidPlayer` is read by the client then never referenced (DPClient.cpp:340
 * -- only two occurrences in the whole file, both the read), so a single shared
 * NULL_ID packet broadcast to every visible peer is safe and avoids a
 * per-recipient build.
 *
 * @module net/snapshot/destPos.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import type { Vec3 } from '@flyff/entities';
import { SNAPSHOTTYPE_DESTPOS, NULL_ID } from './constants';

/** Parsed DESTPOS body fields (DPSrvr.cpp:4364 OnPlayerDestPos read order). */
export interface DestPosFrame {
  vPos: Vec3;
  /** Facing/forward flag (BYTE). */
  fForward: number;
}

export class DestPosSerializer {
  /** Build the SNAPSHOT/DESTPOS broadcast payload for `senderObjid`. */
  build(senderObjid: number, frame: DestPosFrame): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);       // 0xffffff00
    w.writeDword(NULL_ID);                    // objidPlayer -- unused client-side
    w.writeWord(1);                           // cb = 1 entry
    w.writeDword(senderObjid);                // GETID(pMover)
    w.writeWord(SNAPSHOTTYPE_DESTPOS);        // 0x00c1
    w.writeFloat(frame.vPos.x);
    w.writeFloat(frame.vPos.y);
    w.writeFloat(frame.vPos.z);
    w.writeByte(frame.fForward);
    return w.build();
  }
}

/**
 * S→C whisper error reply — `SNAPSHOTTYPE_RETURNSAY` (0x00a9).
 *
 * Mirrors `CUser::AddReturnSay` (`WORLDSERVER/User.cpp:1123`):
 *   m_Snapshot.ar << GetId();              // recipient objid
 *   m_Snapshot.ar << SNAPSHOTTYPE_RETURNSAY;
 *   m_Snapshot.ar << ReturnFlag;           // int (DWORD)
 *   m_Snapshot.ar.WriteString(lpszPlayer);
 *
 * ReturnFlag: `2` = self-target ("can't whisper yourself"),
 * `3` = player not found. Sent only to the originator.
 *
 * @module net/snapshot/returnSay.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import { NULL_ID, SNAPSHOTTYPE_RETURNSAY } from './constants.js';

/** C++ ReturnFlag values (TextCmd_whisper:1276, 1284). */
export const RETURN_SELF_TARGET = 2;
export const RETURN_NOT_FOUND = 3;

export class ReturnSaySerializer {
  build(recipientObjid: number, flag: number, playerName: string): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);
    w.writeWord(1);
    w.writeDword(recipientObjid);
    w.writeWord(SNAPSHOTTYPE_RETURNSAY);
    w.writeDword(flag);
    w.writeString(playerName);
    return w.build();
  }
}

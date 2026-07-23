/**
 * S->C shout -- `SNAPSHOTTYPE_SHOUT` (0x00d0) inside a SNAPSHOT frame.
 *
 * Mirrors the local-build path of `TextCmd_shout` (`FuncTextCmd.cpp:1549`):
 *   arBlock << NULL_ID << SNAPSHOTTYPE_SHOUT;
 *   arBlock << GETID(pUser);          // sender objid
 *   arBlock.WriteString(pUser->GetName());
 *   arBlock.WriteString(szString);
 *   arBlock << dwColor;               // 0xffff99cc default
 *
 * Wire layout (after the outer SNAPSHOT/NULL_ID/count preamble):
 *   headerObjid(NULL_ID) | SHOUT | senderObjid:DWORD | senderName:String | msg:String | color:DWORD
 *
 * Shout is server-wide -- distribute via `PlayerManager.all()`, not zone radius.
 *
 * @module net/snapshot/shout.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID, SNAPSHOTTYPE_SHOUT, SHOUT_COLOR_DEFAULT } from '@flyff/world-core';

export interface ShoutFrame {
  senderObjid: number;
  senderName: string;
  text: string;
  color?: number;
}

export class ShoutSerializer {
  build(frame: ShoutFrame): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);
    w.writeWord(1);
    w.writeDword(NULL_ID); // header objid -- shout is a broadcast, not tied to a receiver obj
    w.writeWord(SNAPSHOTTYPE_SHOUT);
    w.writeDword(frame.senderObjid);
    w.writeString(frame.senderName);
    w.writeString(frame.text);
    w.writeDword(frame.color ?? SHOUT_COLOR_DEFAULT);
    return w.build();
  }
}

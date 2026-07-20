/**
 * S→C CHAT broadcast — `SNAPSHOTTYPE_CHATTEXT` (0x00bc) inside a SNAPSHOT frame.
 *
 * Mirrors `CUserMng::AddChat` (`WORLDSERVER/User.cpp:2100`):
 *   ar << GETID(pUser) << SNAPSHOTTYPE_CHATTEXT;
 *   ar << (DWORD)pUser->GetJob() << pUser->GetName() << pUser->GetLevel() << sChat;
 *
 * Wire layout (after the outer SNAPSHOT/NULL_ID/count/objid/word preamble):
 *   jobId:DWORD  name:String  level:DWORD  text:String
 *
 * Sent to every player within `VISIBILITY_RADIUS` of the speaker.
 *
 * @module net/snapshot/chat.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import { NULL_ID, SNAPSHOTTYPE_CHAT_OUT } from './constants.js';

export interface ChatFrame {
  speakerName: string;
  speakerJobId: number;
  speakerLevel: number;
  text: string;
}

export class ChatSerializer {
  build(speakerObjid: number, frame: ChatFrame): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);
    w.writeWord(1);
    w.writeDword(speakerObjid);
    w.writeWord(SNAPSHOTTYPE_CHAT_OUT);
    w.writeDword(frame.speakerJobId);
    w.writeString(frame.speakerName);
    w.writeDword(frame.speakerLevel);
    w.writeString(frame.text);
    return w.build();
  }
}

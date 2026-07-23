/**
 * S->C vicinity chat -- `SNAPSHOTTYPE_CHAT` (0x0001) inside a SNAPSHOT frame.
 *
 * Mirrors `CUserMng::AddChat` (`WORLDSERVER/User.cpp:2925`):
 *   ar << GETID(pCtrl) << SNAPSHOTTYPE_CHAT;
 *   ar.WriteString(szChat);
 *
 * Wire layout (after the outer SNAPSHOT/NULL_ID/count/objid/word preamble):
 *   text:String
 *
 * The speaker's name/level/job are NOT sent -- the client resolves them from
 * the objid it already has from ADD_OBJ. Sent to every player within
 * `VISIBILITY_RADIUS` of the speaker.
 *
 * @module net/snapshot/chat.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID, SNAPSHOTTYPE_CHAT } from './constants';

export class ChatSerializer {
  build(speakerObjid: number, text: string): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);
    w.writeWord(1);
    w.writeDword(speakerObjid);
    w.writeWord(SNAPSHOTTYPE_CHAT);
    w.writeString(text);
    return w.build();
  }
}

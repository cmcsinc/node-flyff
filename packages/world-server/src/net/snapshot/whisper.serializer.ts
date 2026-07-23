/**
 * S->C whisper -- top-level `PACKETTYPE_WHISPER` (0x00ff00d4).
 *
 * Unlike vicinity chat/shout (snapshots), whisper is a standalone packet -- the
 * cache server enriches the world's `{idFrom, idTo, msg}` relay with both
 * player names before delivery (DPCoreClient.cpp:419 -> cache -> Neuz
 * `OnWhisper`, DPClient.cpp:7298). In this single-process emulator the world
 * owns both names already, so we build the final client packet directly.
 *
 * Wire layout (after the 0x5E frame + opcode DWORD):
 *   sPlayerFrom:String  sPlayerTo:String  msg:String  idFrom:DWORD  idTo:DWORD  nSearch:DWORD
 *
 * `nSearch != 0` = "user offline" flag (cache sets it when the recipient isn't
 * connected). We always send 0 -- by the time we build this both peers are live.
 *
 * @module net/snapshot/whisper.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';

export interface WhisperFrame {
  fromName: string;
  toName: string;
  text: string;
  fromId: number;
  toId: number;
  /** Offline flag. 0 = delivered; non-zero renders "user offline" client-side. */
  search?: number;
}

export class WhisperSerializer {
  build(frame: WhisperFrame): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.WHISPER);
    w.writeString(frame.fromName);
    w.writeString(frame.toName);
    w.writeString(frame.text);
    w.writeDword(frame.fromId);
    w.writeDword(frame.toId);
    w.writeDword(frame.search ?? 0);
    return w.build();
  }
}

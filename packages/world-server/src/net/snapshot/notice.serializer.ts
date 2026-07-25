/**
 * S->C per-user text -- `SNAPSHOTTYPE_TEXT` (0x00a0).
 *
 * Mirrors `CUser::AddText` (`game/source/WORLDSERVER/User.cpp:674`). The build
 * defines `__S_SERVER_UNIFY`, so AddText writes a `TEXT_GENERAL` BYTE between the
 * sub-type and the string -- the client's `OnText` reads it as `nState` before
 * the string. Omit it and the string-length DWORD shifts -> garbled text ->
 * silent drop.
 *   m_Snapshot.ar << NULL_ID;
 *   m_Snapshot.ar << SNAPSHOTTYPE_TEXT;
 *   m_Snapshot.ar << TEXT_GENERAL;       // __S_SERVER_UNIFY
 *   m_Snapshot.ar.WriteString(lpsz);
 *   m_Snapshot.ar << dwColor;
 *
 * Used for `/sys` notices (yellow center-screen) and GM messages. Delivered to
 * a single socket; for a server-wide notice, call per-recipient.
 *
 * @module net/snapshot/notice.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID, SNAPSHOTTYPE_TEXT, TEXT_GENERAL, TEXT_COLOR_NOTICE } from '@flyff/world-core';

export class NoticeSerializer {
  build(text: string, color?: number): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);
    w.writeWord(1);
    w.writeDword(NULL_ID);
    w.writeWord(SNAPSHOTTYPE_TEXT);
    w.writeByte(TEXT_GENERAL);
    w.writeString(text);
    w.writeDword(color ?? TEXT_COLOR_NOTICE);
    return w.build();
  }
}

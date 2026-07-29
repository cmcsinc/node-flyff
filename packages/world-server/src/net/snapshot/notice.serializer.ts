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
import {
  NULL_ID,
  SNAPSHOTTYPE_TEXT,
  SNAPSHOTTYPE_DEFINEDTEXT,
  TEXT_GENERAL,
  TEXT_COLOR_NOTICE,
  TID_GAME_REAPMONEY,
} from '@flyff/world-core';

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

/**
 * `CUser::AddGoldText` (`game/source/WORLDSERVER/User.cpp:2175`) -->
 * `AddDefinedText(TID_GAME_REAPMONEY, "%s %s", strPlus, strGold)`
 * (`User.cpp:2200`):
 *   m_Snapshot.ar << GetId();
 *   m_Snapshot.ar << SNAPSHOTTYPE_DEFINEDTEXT;
 *   m_Snapshot.ar << dwText;               // DWORD defineText.h id
 *   m_Snapshot.ar.WriteString(szBuffer);   // printf args, space-delimited
 * Note: unlike `SNAPSHOTTYPE_TEXT` there is NO state byte and NO trailing color
 * DWORD -- the client resolves both template and color from `textClient.inc`.
 *
 * Both numbers go through `GetNumberFormatEx` (`PatchClient/xUtil.h:44`) -->
 * comma thousands separators, hence `toLocaleString('en-US')`.
 *
 * @param objid  looter's stable `m_dwObjId` (C++ passes `GetId()`, not NULL_ID)
 * @param plus   penya just gained
 * @param total  penya held AFTER the add (`AddGold` runs before the text)
 */
export function buildGoldText(objid: number, plus: number, total: number): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(objid);
  w.writeWord(1);
  w.writeDword(objid);
  w.writeWord(SNAPSHOTTYPE_DEFINEDTEXT);
  w.writeDword(TID_GAME_REAPMONEY);
  w.writeString(`${plus.toLocaleString('en-US')} ${total.toLocaleString('en-US')}`);
  return w.build();
}

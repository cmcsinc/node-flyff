/**
 * S->C quest snapshot serializers.
 *
 * Each frame is one per-user snapshot wrapped in `PACKETTYPE_SNAPSHOT`
 * (`objid | NULL_ID | WORD 1 | OBJID | WORD subtype | payload`) -- mirrors
 * `CUser::AddSetQuest` / `AddCancelQuest` / `AddCheckedQuest` / `AddQuestTextTime`
 * / `AddNPCPos` (`WORLDSERVER/User.cpp:1367/1819/5127/5807/5973`).
 *
 * The 12-byte `QUEST` struct layout (MSVC x86 default alignment,
 * `_Common/Mover.h:267`, blitted raw at `ObjSerializeOpt.cpp:202`):
 *
 * ```
 *  offset 0   m_nState         u8     QS_* (0..14)
 *  offset 1   pad              0x00
 *  offset 2   m_wTime          u16 LE remaining limit (bit15 = expired)
 *  offset 4   m_wId            u16 LE quest id
 *  offset 6   m_nKillNPCNum[0] u16 LE
 *  offset 8   m_nKillNPCNum[1] u16 LE
 *  offset 10  flags            u8     bit0=m_bPatrol, bit1=m_bDialog
 *  offset 11  pad              0x00
 * ```
 *
 * Padding bytes go on the wire -- do NOT pack.
 *
 * @module net/snapshot/quest.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import type { RuntimeQuest } from '@flyff/entities';
import {
  NULL_ID,
  SNAPSHOTTYPE_SETQUEST,
  SNAPSHOTTYPE_QUEST_REMOVE,
  SNAPSHOTTYPE_QUEST_CHECKED,
  SNAPSHOTTYPE_QUEST_TEXT_TIME,
  SNAPSHOTTYPE_QUESTHELPER_NPCPOS,
} from '@flyff/world-core';

// RuntimeQuest moved to @flyff/entities (shared with CPlayer.m_aQuest) -- re-export
// so legacy `from './quest.serializer'` importers keep resolving.
export type { RuntimeQuest };

/** Open a single-snapshot SNAPSHOT frame (`objid | NULL_ID | 1 | objid | subtype`). */
function frame(objid: number, subtype: number, w: PacketWriter): PacketWriter {
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(NULL_ID);
  w.writeWord(1);
  w.writeDword(objid);
  w.writeWord(subtype);
  return w;
}

/** Write the 12-byte QUEST struct (used inline by the JOIN blob too). */
export function writeQuestStruct(w: PacketWriter, q: RuntimeQuest): void {
  w.writeByte(q.state & 0xff);              // offset 0  m_nState
  w.writeByte(0);                           // offset 1  pad
  w.writeWord(q.time & 0xffff);             // offset 2  m_wTime
  w.writeWord(q.id & 0xffff);               // offset 4  m_wId
  w.writeWord(q.killNpcNum[0] & 0xffff);    // offset 6  m_nKillNPCNum[0]
  w.writeWord(q.killNpcNum[1] & 0xffff);    // offset 8  m_nKillNPCNum[1]
  w.writeByte(q.flags & 0xff);              // offset 10 flags
  w.writeByte(0);                           // offset 11 pad
}

/** `SNAPSHOTTYPE_SETQUEST` (0x00b0) -- push one quest state change. */
export function buildSetQuest(objid: number, q: RuntimeQuest): Buffer {
  const w = frame(objid, SNAPSHOTTYPE_SETQUEST, new PacketWriter());
  writeQuestStruct(w, q);
  return w.build();
}

/**
 * `SNAPSHOTTYPE_QUEST_REMOVE` (0x003a) -- `int nRemoveType, DWORD dwQuestCancelID`.
 * `type` is a REMOVEQUEST_TYPE value (-1 cancel / 0 silent / 1 all / 2 clear-completed).
 */
export function buildRemoveQuest(objid: number, type: number, questId: number): Buffer {
  const w = frame(objid, SNAPSHOTTYPE_QUEST_REMOVE, new PacketWriter());
  w.writeDword(type);          // int nRemoveType (signed 32)
  w.writeDword(questId);       // DWORD dwQuestCancelID
  return w.build();
}

/** `SNAPSHOTTYPE_QUEST_CHECKED` (0x8820) -- `BYTE size, size*WORD` (full replace). */
export function buildCheckedQuest(objid: number, questIds: number[]): Buffer {
  const w = frame(objid, SNAPSHOTTYPE_QUEST_CHECKED, new PacketWriter());
  w.writeByte(questIds.length & 0xff);
  for (const id of questIds) w.writeWord(id & 0xffff);
  return w.build();
}

/** `SNAPSHOTTYPE_QUEST_TEXT_TIME` (0x00ba) -- `BOOL(4B), int nState, DWORD dwTime`. */
export function buildQuestTextTime(objid: number, flag: boolean, state: number, time: number): Buffer {
  const w = frame(objid, SNAPSHOTTYPE_QUEST_TEXT_TIME, new PacketWriter());
  w.writeDword(flag ? 1 : 0);
  w.writeDword(state);
  w.writeDword(time);
  return w.build();
}

/** `SNAPSHOTTYPE_QUESTHELPER_NPCPOS` (0x9400) -- `D3DVECTOR` (3* float). */
export function buildNpcPos(objid: number, pos: { x: number; y: number; z: number }): Buffer {
  const w = frame(objid, SNAPSHOTTYPE_QUESTHELPER_NPCPOS, new PacketWriter());
  w.writeFloat(pos.x);
  w.writeFloat(pos.y);
  w.writeFloat(pos.z);
  return w.build();
}

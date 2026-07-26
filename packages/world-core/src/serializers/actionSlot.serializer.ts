/**
 * Action-slot S->C snapshots -- ENDSKILLQUEUE (queue done) + SETACTIONPOINT.
 *
 * `CUserTaskBar::OnEndSkillQueue` (`_Interface/UserTaskBar.cpp:195`) writes a
 * bodyless self-only header:
 * ```
 * ar << GETID(pUser) << SNAPSHOTTYPE_ENDSKILLQUEUE;   // 0x00e5
 * ```
 * The client's `OnEndSkillQueue` (`Neuz/DPClient.cpp:15646`) clears the queued
 * skill slot in the F1-F9 grid. Sent both on queue exhaust (server-driven, at
 * the end of `SetNextSkill`) and in ack of the client's `ENDSKILLQUEUE` cancel.
 *
 * `CUser::AddSetActionPoint` (`WORLDSERVER/UserLux.cpp:206`):
 * ```
 * ar << GETID(pUser) << SNAPSHOTTYPE_SETACTIONPOINT << nAP;   // 0x00c5
 * ```
 * Self-only; the client updates the action-slot AP counter. Sent on each AP
 * spend during queue progression.
 *
 * @module net/snapshot/actionSlot
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID, SNAPSHOTTYPE_ENDSKILLQUEUE, SNAPSHOTTYPE_SETACTIONPOINT } from '../snapshot-constants';

/** `objid | 0x00e5` -- bodyless, self-only. Queue done / cancel ack. */
export function buildEndSkillQueue(objid: number): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(NULL_ID);
  w.writeWord(1);
  w.writeDword(objid);
  w.writeWord(SNAPSHOTTYPE_ENDSKILLQUEUE);
  return w.build();
}

/**
 * `objid | 0x00c5 | int nAP` -- action-point sync, self-only.
 *
 * v15 only. The v19 client gates the `case SNAPSHOTTYPE_SETACTIONPOINT` handler
 * out with `#ifndef __NEW_TASKBAR_V19` (`Neuz/DPClient.cpp:608`); emitting 0x00c5
 * under v19 hits `default: ASSERT(0)` in the SNAPSHOT switch, the trailing
 * `int nAP` is never consumed, and the stream desyncs -> crash. Do NOT wire this
 * from any v19 service (kept for byte-layout / v15 compatibility only).
 */
export function buildSetActionPoint(objid: number, ap: number): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(NULL_ID);
  w.writeWord(1);
  w.writeDword(objid);
  w.writeWord(SNAPSHOTTYPE_SETACTIONPOINT);
  w.writeDword(ap);
  return w.build();
}

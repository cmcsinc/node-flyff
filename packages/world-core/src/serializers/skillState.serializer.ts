/**
 * Skill-buff S->C snapshots -- the icon/timer half of the two-layer buff
 * protocol (the stat delta rides `SETDESTPARAM`, a later slice).
 *
 * `CUserMng::AddSetSkillState` (`WORLDSERVER/User.cpp:5672`):
 * ```
 * ar << GETID(pCenter) << SNAPSHOTTYPE_SETSKILLSTATE;   // 0x004c
 * ar << pTarget->GetId() << wType << wID << dwLevel << dwTime;
 * ```
 * `CUser::AddRemoveSkillInfluence` (`WORLDSERVER/User.cpp:1025`):
 * ```
 * ar << GetId() << SNAPSHOTTYPE_REMOVESKILLINFULENCE;   // 0x00f8
 * ar << wType << wID;
 * ```
 * Both broadcast to the visibility range. `wType` is the buff source
 * (`BUFF_SKILL=1`, ...), `wID` the skill id, `dwLevel` the skill level, and
 * `dwTime` the **remaining** duration in ms (client counts the icon down).
 *
 * @module net/snapshot/skillState
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import {
  NULL_ID,
  SNAPSHOTTYPE_SETSKILLSTATE,
  SNAPSHOTTYPE_REMOVESKILLINFULENCE,
  SNAPSHOTTYPE_SETDESTPARAM,
  SNAPSHOTTYPE_RESETDESTPARAM,
} from '../snapshot-constants';

/** `CHG_SENTINEL` (defineAttribute.h) -- "no override" marker sent on the wire. */
const CHG_SENTINEL = 0x7fffffff;

/** `objid | 0x004c | word type | word skillId | dword level | dword remainMs`. */
export function buildSetSkillState(
  objid: number,
  type: number,
  skillId: number,
  level: number,
  remainMs: number,
): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(NULL_ID);
  w.writeWord(1);
  w.writeDword(objid);
  w.writeWord(SNAPSHOTTYPE_SETSKILLSTATE);
  w.writeWord(type);
  w.writeWord(skillId);
  w.writeDword(level);
  w.writeDword(remainMs);
  return w.build();
}

/** `objid | 0x00f8 | word type | word skillId`. */
export function buildRemoveSkillInfluence(objid: number, type: number, skillId: number): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(NULL_ID);
  w.writeWord(1);
  w.writeDword(objid);
  w.writeWord(SNAPSHOTTYPE_REMOVESKILLINFULENCE);
  w.writeWord(type);
  w.writeWord(skillId);
  return w.build();
}

/**
 * `objid | 0x001c | dword dst | dword adj | dword chg` -- a DST apply delta.
 * `chg` defaults to the `0x7FFFFFFF` "no override" sentinel (additive-only).
 */
export function buildSetDestParam(objid: number, dst: number, adj: number, chg: number = CHG_SENTINEL): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(NULL_ID);
  w.writeWord(1);
  w.writeDword(objid);
  w.writeWord(SNAPSHOTTYPE_SETDESTPARAM);
  w.writeDword(dst);
  w.writeDword(adj);
  w.writeDword(chg);
  return w.build();
}

/** `objid | 0x001d | dword dst | dword adj` -- a DST reverse delta. */
export function buildResetDestParam(objid: number, dst: number, adj: number): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.SNAPSHOT);
  w.writeDword(NULL_ID);
  w.writeWord(1);
  w.writeDword(objid);
  w.writeWord(SNAPSHOTTYPE_RESETDESTPARAM);
  w.writeDword(dst);
  w.writeDword(adj);
  return w.build();
}

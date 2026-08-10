/**
 * DOUSESKILLPOINT S->C snapshot -- learn / skill-point confirm (`MsgHdr.h:996`).
 *
 * `CUserMng::AddDoUseSkillPoint` (`WORLDSERVER/User.cpp:4830`):
 * ```
 * ar << GETID(pMover);
 * ar << SNAPSHOTTYPE_DOUSESKILLPOINT;          // 0x007d
 * for (i = 0; i < MAX_SKILL_JOB; i++)          // 51 slots under v19 __3RD_LEGEND16
 *   ar << m_aJobSkill[i].dwSkill << m_aJobSkill[i].dwLevel;
 * ar << m_nSkillPoint;                         // unspent SP after the spend
 * ```
 * Self only -- the client rebuilds its skill window from this roster + updates
 * the SP counter. Sent on learn (`OnDoUseSkillPoint`) AND reused on level-up SP
 * grant to refresh the SP display with the unchanged roster.
 *
 * @module net/snapshot/doUseSkillPoint
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID, MAX_SKILL_JOB, SNAPSHOTTYPE_DOUSESKILLPOINT } from '@flyff/world-core';

/** Minimal slot view the serializer consumes (CPlayer.m_aJobSkill already matches). */
export interface DoUseSkillSlot {
  skillId: number;
  level: number;
}

export class DoUseSkillPointSerializer {
  /**
   * @param casterObjid - player objid (m_idPlayer).
   * @param roster      - full m_aJobSkill (MAX_SKILL_JOB slots; empty carry NULL_ID).
   * @param skillPoint  - current unspent SP (m_nSkillPoint).
   */
  build(
    casterObjid: number,
    roster: readonly DoUseSkillSlot[],
    skillPoint: number,
  ): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);
    w.writeWord(1);
    w.writeDword(casterObjid);
    w.writeWord(SNAPSHOTTYPE_DOUSESKILLPOINT);
    for (let i = 0; i < MAX_SKILL_JOB; i++) {
      const s = roster[i];
      // Empty slots serialize as NULL_ID / 0 -- matches C++ ObjSerializeOpt.cpp.
      w.writeDword(s?.skillId ?? NULL_ID);
      w.writeDword(s?.level ?? 0);
    }
    w.writeDword(skillPoint);
    return w.build();
  }
}

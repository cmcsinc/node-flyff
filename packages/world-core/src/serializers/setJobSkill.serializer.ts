/**
 * SET_JOB_SKILL S->C snapshot -- job change, self only (`MsgHdr.h:1079`).
 *
 * `CUser::AddSetChangeJob` (`WORLDSERVER/User.cpp:1157`):
 * ```
 * ar << GETID(pMover);
 * ar << SNAPSHOTTYPE_SET_JOB_SKILL;        // 0x00a7
 * ar << nJob;                             // new job id (int)
 * for (i = 0; i < MAX_SKILL_JOB; i++)     // 51 slots under v19 __3RD_LEGEND16
 *   ar << m_aJobSkill[i].dwSkill << m_aJobSkill[i].dwLevel;
 * ar.Write(dwJobLv, sizeof(DWORD) * MAX_JOB);  // per-job levels (all 0 here)
 * ```
 * Sent to self on `AddChangeJob` -- the client rebuilds its skill window from
 * the new roster + job. The trailing `dwJobLv[MAX_JOB]` is a fixed-size block
 * of zeros (the per-job-level array, unused on the change path).
 *
 * @module net/snapshot/setJobSkill
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID, MAX_SKILL_JOB, MAX_JOB, SNAPSHOTTYPE_SET_JOB_SKILL } from '@flyff/world-core';

/** Minimal slot view the serializer consumes (CPlayer.m_aJobSkill matches). */
export interface SetJobSkillSlot {
  skillId: number;
  level: number;
}

export class SetJobSkillSerializer {
  /**
   * @param moverObjid - player objid (m_idPlayer).
   * @param job        - new job id (m_nJob after AddChangeJob).
   * @param roster     - full m_aJobSkill (MAX_SKILL_JOB slots; empty carry NULL_ID).
   */
  build(
    moverObjid: number,
    job: number,
    roster: ReadonlyArray<SetJobSkillSlot>,
  ): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);
    w.writeWord(1);
    w.writeDword(moverObjid);
    w.writeWord(SNAPSHOTTYPE_SET_JOB_SKILL);
    w.writeDword(job);
    for (let i = 0; i < MAX_SKILL_JOB; i++) {
      const s = roster[i];
      // Empty slots serialize as NULL_ID / 0 -- matches C++ ObjSerializeOpt.cpp.
      w.writeDword(s?.skillId ?? NULL_ID);
      w.writeDword(s?.level ?? 0);
    }
    // Trailing dwJobLv[MAX_JOB] -- per-job-level block, all zeros on the change
    // path (C++ initializes `DWORD dwJobLv[MAX_JOB] = {0,}`).
    for (let i = 0; i < MAX_JOB; i++) {
      w.writeDword(0);
    }
    return w.build();
  }
}

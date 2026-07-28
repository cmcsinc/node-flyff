/**
 * SET_NEAR_JOB_SKILL S->C snapshot -- job change, vicinity excl caster
 * (`MsgHdr.h:1080`).
 *
 * `CUserMng::AddNearSetChangeJob` (`WORLDSERVER/User.cpp:5107`):
 * ```
 * ar << GETID(pMover);
 * ar << SNAPSHOTTYPE_SET_NEAR_JOB_SKILL;  // 0x00a8
 * ar << nJob;                            // new job id
 * ```
 * Broadcast to vicinity (excl self) on `AddChangeJob` -- peers refresh the
 * mover's job (animation/equipment appearance). Self gets the full roster via
 * SET_JOB_SKILL instead.
 *
 * @module net/snapshot/setNearJobSkill
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID, SNAPSHOTTYPE_SET_NEAR_JOB_SKILL } from '@flyff/world-core';

export class SetNearJobSkillSerializer {
  build(moverObjid: number, job: number): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);
    w.writeWord(1);
    w.writeDword(moverObjid);
    w.writeWord(SNAPSHOTTYPE_SET_NEAR_JOB_SKILL);
    w.writeDword(job);
    return w.build();
  }
}

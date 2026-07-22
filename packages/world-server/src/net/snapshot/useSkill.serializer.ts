/**
 * USESKILL + CLEAR_USESKILL S->C snapshots -- skill cast start + cancel.
 *
 * `CUserMng::AddUseSkill` (`WORLDSERVER/User.cpp:4501`):
 * ```
 * ar << GETID(pMover);
 * ar << SNAPSHOTTYPE_USESKILL;        // 0x0019
 * ar << dwSkill << dwLevel;           // skill id + learned level
 * ar << dwObjid;                      // target objid (NULL_ID if self/ground)
 * ar << nUseType;                     // SUT_* (0 instant, 1 charge, 2 control)
 * ar << nCastingTime;                 // cast bar duration in ms
 * ```
 * Vicinity **incl caster** -- the caster's own client consumes this to draw the
 * cast bar + start the skill animation (docs `skills-research.md` #3).
 *
 * `AddClearUseSkill` (MsgHdr.h:885) is header-only: `OBJID | 0x001a`. Sent
 * self-only when the server rejects a cast (dead, cooldown, no MP/FP, invalid
 * target) so the client cancels its predicted animation.
 *
 * @module net/snapshot/useSkill
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import { NULL_ID, SNAPSHOTTYPE_USESKILL, SNAPSHOTTYPE_CLEAR_USESKILL } from './constants.js';

/** Fields for the USESKILL cast-start snapshot. */
export interface UseSkillFrame {
  /** Resolved SI_* skill id. */
  skillId: number;
  /** Learned skill level (1..dwExpertMax). */
  level: number;
  /** Target objid (NULL_ID for self/ground-target skills). */
  target: number;
  /** SUT_* use type echoed from the client's USESKILL packet. */
  useType: number;
  /** Cast bar duration in ms (from propSkillAdd `dwCastingTime`). */
  castingTime: number;
}

/**
 * USESKILL + CLEAR_USESKILL serializer. One class -- both snapshots share the
 * caster-objid prefix and the SNAPSHOT envelope; clear is just the header.
 */
export class UseSkillSerializer {
  /** `objid | 0x0019 | dwSkill | dwLevel | target | nUseType | nCastingTime`. */
  build(casterObjid: number, frame: UseSkillFrame): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);
    w.writeWord(1);
    w.writeDword(casterObjid);
    w.writeWord(SNAPSHOTTYPE_USESKILL);
    w.writeDword(frame.skillId);
    w.writeDword(frame.level);
    w.writeDword(frame.target);
    w.writeDword(frame.useType);
    w.writeDword(frame.castingTime);
    return w.build();
  }

  /** Header-only `objid | 0x001a` -- cast rejected, self only. */
  buildClear(casterObjid: number): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);
    w.writeWord(1);
    w.writeDword(casterObjid);
    w.writeWord(SNAPSHOTTYPE_CLEAR_USESKILL);
    return w.build();
  }
}

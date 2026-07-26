/**
 * DOAPPLYUSESKILL S->C snapshot -- a server-applied skill (no client cast bar).
 *
 * `g_UserMng.AddDoApplySkill` (`WORLDSERVER/UserLux.cpp:272-282`):
 * ```
 * ar << GETID( pCtrl );                  // caster objid
 * ar << SNAPSHOTTYPE_DOAPPLYUSESKILL;     // 0x00d7
 * ar << idTarget << dwSkill << dwLevel;
 * ```
 * Broadcast to the visibility range (incl caster). The client receiver
 * `OnDoApplySkill` (`Neuz/DPClient.cpp:15263-15286`) resolves the skill prop +
 * runs `pCtrl->DoApplySkill` locally -- driving the cast animation + applying
 * the skill's DST effects on the client. Used by the NPC buff-pang path
 * (`OnNPCBuff`, DPSrvr.cpp:11290) after each `SetBuffSkill` entry attaches.
 *
 * @module net/snapshot/doApplyUseSkill
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID, SNAPSHOTTYPE_DOAPPLYUSESKILL } from '@flyff/world-core';

export class DoApplyUseSkillSerializer {
  /** `objid | 0x00d7 | target | skillId | level`. */
  build(casterObjid: number, targetObjid: number, skillId: number, level: number): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);
    w.writeWord(1);
    w.writeDword(casterObjid);
    w.writeWord(SNAPSHOTTYPE_DOAPPLYUSESKILL);
    w.writeDword(targetObjid);
    w.writeDword(skillId);
    w.writeDword(level);
    return w.build();
  }
}

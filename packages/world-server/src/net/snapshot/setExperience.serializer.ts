/**
 * S->C SETEXPERIENCE snapshot -- `SNAPSHOTTYPE_SETEXPERIENCE` (0x0012).
 *
 * Mirrors `CUser::AddSetExperience` (`WORLDSERVER/User.cpp:1115`):
 *   ar << GETID(pPlayer) << SNAPSHOTTYPE_SETEXPERIENCE;
 *   ar << nExp1(__int64) << wLevel(WORD) << nSkillLevel(DWORD)
 *      << nSkillPoint(DWORD) << nDeathExp(__int64) << wDeathLevel(WORD);
 *
 * **Self-only** (per-user `m_Snapshot`, NOT vicinity). Sent on exp gain / level
 * up. `nSkillLevel`/`nSkillPoint` belong to the job-skill system (stubbed 0
 * until skills ship). `nDeathExp`/`wDeathLevel` track the death-penalty cursor
 * (0 until player-death lands).
 *
 * @module net/snapshot/setExperience.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { SNAPSHOTTYPE_SETEXPERIENCE, NULL_ID } from '@flyff/world-core';

export interface ExperienceFrame {
  readonly exp: number;
  readonly level: number;
  readonly skillLevel?: number;
  readonly skillPoint?: number;
}

export class SetExperienceSerializer {
  build(playerObjid: number, f: ExperienceFrame): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);
    w.writeWord(1);
    w.writeDword(playerObjid);
    w.writeWord(SNAPSHOTTYPE_SETEXPERIENCE);
    w.writeQword(Math.floor(f.exp));                // nExp1 (__int64)
    w.writeWord(f.level & 0xffff);                  // wLevel
    w.writeDword(f.skillLevel ?? 0);                // nSkillLevel
    w.writeDword(f.skillPoint ?? 0);                // nSkillPoint
    w.writeQword(0);                                // nDeathExp (__int64) -- death penalty; v1: 0
    w.writeWord(0);                                 // wDeathLevel -- v1: 0
    return w.build();
  }
}

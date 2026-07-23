/**
 * S->C MELEE_ATTACK broadcast -- attacker swing animation echo to zone peers.
 *
 * Mirrors `CUserMng::AddMeleeAttack` (`WORLDSERVER/User.cpp:4769-4781`):
 *   ar << GETID( pMover ) << SNAPSHOTTYPE_MELEE_ATTACK;
 *   ar << dwAtkMsg << objid << nParam2 << nParam3;
 *
 * The peer client plays the matching swing (`CDPClient::OnMeleeAttack` ->
 * `SendActMsg`, Neuz/DPClient.cpp:3736) using `dwAtkMsg` (OBJMSG_ATK1..4 = 29-32).
 * The `__HACK_1023` trailing `fVal` from the C->S packet is NOT echoed -- it is an
 * anti-cheat check only. Sender excluded by `fTransferToMe=FALSE`.
 *
 * No damage here -- damage/HP/death land with the combat system (Tier 0 blocker).
 *
 * @module net/snapshot/meleeAttack.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { SNAPSHOTTYPE_MELEE_ATTACK, NULL_ID } from '@flyff/world-core';

export interface MeleeAttackFrame {
  /** `OBJMSG_*` (DWORD) -- swing animation id (29-32 = ATK1..ATK4). */
  dwAtkMsg: number;
  /** Target object id (DWORD). */
  objid: number;
  /** `MAKELONG(lo, hi)` (int32). */
  nParam2: number;
  /** `MAKELONG(lo, hi)` (int32) -- HIWORD drives peer hit SFX. */
  nParam3: number;
}

export class MeleeAttackSerializer {
  /** Build the SNAPSHOT/MELEE_ATTACK broadcast payload for `senderObjid`. */
  build(senderObjid: number, frame: MeleeAttackFrame): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);     // 0xffffff00
    w.writeDword(NULL_ID);                 // objidPlayer -- unused client-side
    w.writeWord(1);                        // cb = 1 entry
    w.writeDword(senderObjid);             // GETID(pMover) -- the attacker
    w.writeWord(SNAPSHOTTYPE_MELEE_ATTACK);// 0x00e0
    w.writeDword(frame.dwAtkMsg);
    w.writeDword(frame.objid);
    w.writeLong(frame.nParam2);
    w.writeLong(frame.nParam3);
    return w.build();
  }
}

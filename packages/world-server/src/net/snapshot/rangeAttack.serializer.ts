/**
 * S->C RANGE_ATTACK broadcast -- ranged attacker swing/projectile echo to zone peers.
 *
 * Mirrors `CUserMng::AddRangeAttack` (`WORLDSERVER/User.cpp:4811-4823`):
 *   ar << GETID( pMover ) << SNAPSHOTTYPE_RANGE_ATTACK;
 *   ar << dwAtkMsg << objid << nParam2 << nParam3 << idSfxHit;
 *
 * Same shape as {@link MeleeAttackSerializer} plus a trailing `idSfxHit` DWORD
 * (the projectile/hit SFX id; 0 = none). The peer client plays the ranged
 * swing (`CDPClient::OnRangeAttack`, Neuz/DPClient.cpp:567). Damage still lands
 * via the same `SNAPSHOTTYPE_DAMAGE` snapshot as melee -- the projectile visual
 * is client-side only.
 *
 * @module net/snapshot/rangeAttack.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { SNAPSHOTTYPE_RANGE_ATTACK, NULL_ID } from './constants';

export interface RangeAttackFrame {
  /** `OBJMSG_ATK_RANGE*` (DWORD) -- ranged swing id. */
  dwAtkMsg: number;
  /** Target object id (DWORD). */
  objid: number;
  /** `MAKELONG(lo, hi)` (int32). */
  nParam2: number;
  /** `MAKELONG(lo, hi)` (int32) -- HIWORD drives peer hit SFX. */
  nParam3: number;
  /** Hit SFX id (DWORD) -- 0 = none. */
  idSfxHit: number;
}

export class RangeAttackSerializer {
  /** Build the SNAPSHOT/RANGE_ATTACK broadcast payload for `senderObjid`. */
  build(senderObjid: number, frame: RangeAttackFrame): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);       // 0xffffff00
    w.writeDword(NULL_ID);                   // objidPlayer -- unused client-side
    w.writeWord(1);                          // cb = 1 entry
    w.writeDword(senderObjid);               // GETID(pMover) -- the attacker
    w.writeWord(SNAPSHOTTYPE_RANGE_ATTACK);  // 0x00e2
    w.writeDword(frame.dwAtkMsg);
    w.writeDword(frame.objid);
    w.writeLong(frame.nParam2);
    w.writeLong(frame.nParam3);
    w.writeDword(frame.idSfxHit);
    return w.build();
  }
}

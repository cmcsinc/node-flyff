/**
 * S→C DAMAGE snapshot — `SNAPSHOTTYPE_DAMAGE` (0x0013).
 *
 * Mirrors `CUserMng::AddDamage` (`WORLDSERVER/User.cpp:4435`):
 *   ar << GETID(pMover) << SNAPSHOTTYPE_DAMAGE;
 *   ar << objidAttacker << dwHit << dwAtkFlags;
 *   if (dwAtkFlags & AF_FLYING) ar << pos(3×float) << angle;
 *
 * This IS the per-mover HP sync — there is no dedicated HP packet. All nearby
 * clients `IncHitPoint(-dwHit)` locally; the red monster bar updates purely
 * from this broadcast (`DPClient.cpp:1724 OnDamage`).
 *
 * Vicinity broadcast (zone peers). v1 never sets `AF_FLYING` (knock-up is
 * skill-driven), so the optional pos/angle tail is omitted.
 *
 * @module net/snapshot/damage.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import { SNAPSHOTTYPE_DAMAGE, NULL_ID } from './constants.js';
import { AF_FLYING } from '../../combat/tables.js';

export interface DamageFrame {
  readonly attackerObjid: number;
  readonly hit: number;
  readonly atkFlags: number;
}

export class DamageSerializer {
  build(victimObjid: number, f: DamageFrame): Buffer {
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.SNAPSHOT);
    w.writeDword(NULL_ID);
    w.writeWord(1);
    w.writeDword(victimObjid);
    w.writeWord(SNAPSHOTTYPE_DAMAGE);
    w.writeDword(f.attackerObjid);
    w.writeDword(f.hit);
    w.writeDword(f.atkFlags);
    if (f.atkFlags & AF_FLYING) {
      // pos (3× float) + angle — appended only on knock-up. v1 never hits this.
      w.writeFloat(0).writeFloat(0).writeFloat(0).writeFloat(0);
    }
    return w.build();
  }
}

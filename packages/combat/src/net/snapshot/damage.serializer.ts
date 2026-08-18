/**
 * S->C DAMAGE snapshot -- `SNAPSHOTTYPE_DAMAGE` (0x0013).
 *
 * Mirrors `CUserMng::AddDamage` (`WORLDSERVER/User.cpp:4435`):
 *   ar << GETID(pMover) << SNAPSHOTTYPE_DAMAGE;
 *   ar << objidAttacker << dwHit << dwAtkFlags;
 *   if (dwAtkFlags & AF_FLYING) ar << pos(3*float) << angle;
 *
 * This IS the per-mover HP sync -- there is no dedicated HP packet. All nearby
 * clients `IncHitPoint(-dwHit)` locally; the red monster bar updates purely
 * from this broadcast (`DPClient.cpp:1724 OnDamage`).
 *
 * Vicinity broadcast (zone peers). The pos/angle tail is written only on a crit
 * knock-up (`AF_FLYING`, set by `GetHitPower` at MoverAttack.cpp:1471).
 *
 * @module net/snapshot/damage.serializer
 */

import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { SNAPSHOTTYPE_DAMAGE, NULL_ID } from '@flyff/world-core';
import { AF_FLYING } from '../../combat/tables';

export interface DamageFrame {
  readonly attackerObjid: number;
  readonly hit: number;
  readonly atkFlags: number;
  /**
   * Victim position + facing, appended only when `AF_FLYING` is set. C++
   * `AddDamage` writes `pMover->GetPos()` / `GetAngle()` -- the *victim's*, not
   * the attacker's; the client `SetPos`/`SetAngle`s from it before running its
   * own `DoDamageFly` arc (`DPClient.cpp:1761`), so this is the launch origin.
   */
  readonly victimPos?: { readonly x: number; readonly y: number; readonly z: number } | undefined;
  readonly victimAngle?: number | undefined;
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
      const p = f.victimPos;
      w.writeFloat(p?.x ?? 0).writeFloat(p?.y ?? 0).writeFloat(p?.z ?? 0);
      w.writeFloat(f.victimAngle ?? 0);
    }
    return w.build();
  }
}

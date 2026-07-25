/**
 * RangeAttackService -- `PACKETTYPE_RANGE_ATTACK` (0x00ff0012).
 *
 * The ranged twin of {@link MeleeAttackService}. `DPSrvr::OnRangeAttack`
 * (DPSrvr.cpp, sibling of `OnMeleeAttack`) reads the same `dwAtkMsg, objid,
 * nParam2, nParam3, fVal` body and echoes a peer-broadcast swing via
 * `CUserMng::AddRangeAttack` (`WORLDSERVER/User.cpp:4811`) -- identical to the
 * melee echo plus a trailing `idSfxHit` DWORD (the projectile/hit SFX id).
 *
 * Damage is IDENTICAL to melee: it lands via the same
 * `CombatService.resolveAttack` -> `SNAPSHOTTYPE_DAMAGE` round-trip. The bow
 * damage curve is already selected inside `getWeaponATK` by the equipped
 * weapon's `WT_RANGE_BOW` type -- there is no separate ranged damage formula.
 * The projectile visual is client-side only. So this service exists purely to
 * play the RANGE swing animation (vs the MELEE one) for the correct weapon.
 *
 * Ammo: v15 retail bows are ammo-less -- there is no arrow/quiver item kind in
 * propItem, so nothing is consumed. (Later Flyff quivers would be a consumable
 * gate here; the emulator has no arrow item concept to enforce.)
 *
 * No WAL (rule 04 -- the swing is not journaled; the shared damage tail journals
 * exp/level on kill exactly as melee does).
 *
 * @module services/rangeAttack
 */

import type { ZoneManager } from '@flyff/world-core';
import type { CPlayer } from '@flyff/entities';
import {
  RangeAttackSerializer, type RangeAttackFrame,
} from '../net/snapshot/rangeAttack.serializer';
import { VISIBILITY_RADIUS, NULL_ID } from '@flyff/world-core';
import type { CombatService } from './combat.service';
import { createLogger } from '@flyff/core/logger';

const logger = createLogger({ module: 'rangeAttack-service' });

export interface RangeAttackServiceDeps {
  zoneManager: ZoneManager;
  combatService: CombatService;
}

export type RangeAttackOutcome =
  | { ok: true; reached: number }
  | { ok: false; reason: 'invalid_target' };

export class RangeAttackService {
  private readonly serializer = new RangeAttackSerializer();
  constructor(private readonly deps: RangeAttackServiceDeps) {}

  /**
   * Broadcast the ranged swing to zone peers, then run the shared damage
   * round-trip (`CombatService.resolveAttack`) against the targeted mover. The
   * swing echo always fires so peers see the projectile animation; damage / HP /
   * death follow the server-authoritative result (bow curve applied via the
   * equipped `WT_RANGE_BOW` weapon).
   */
  attack(player: CPlayer, frame: RangeAttackFrame): RangeAttackOutcome {
    if (frame.objid === NULL_ID) {
      return { ok: false, reason: 'invalid_target' };
    }
    const packet = this.serializer.build(player.m_idPlayer, frame);
    // Exclude the caster: C++ `AddRangeAttack` skips `USERPTR != pMover`. The
    // caster drives its own shot animation locally; echoing back re-queues it
    // (OnRangeAttack) and desyncs auto-attack cadence after a skill. Damage
    // broadcast below still includes the caster.
    const reached = this.deps.zoneManager.broadcastAround(
      player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS, packet, player,
    );
    const res = this.deps.combatService.resolveAttack(player, frame.objid);
    if (!res.ok) {
      // Info-level: a rejected shot is the #1 "can't kill with bow" symptom
      // (stale objid, peaceful NPC, dead target). Prints the exact reason.
      logger.warn(
        { charId: player.m_idPlayer, objid: frame.objid, reason: res.reason },
        'range attack rejected',
      );
    } else if (res.killed) {
      logger.info(
        { charId: player.m_idPlayer, objid: frame.objid, damage: res.damage },
        'range shot killed mover',
      );
    } else {
      logger.debug(
        { charId: player.m_idPlayer, objid: frame.objid, hit: res.hit, damage: res.damage },
        'range shot resolved',
      );
    }
    return { ok: true, reached };
  }
}

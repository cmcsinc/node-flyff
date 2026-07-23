/**
 * MeleeAttackService -- `PACKETTYPE_MELEE_ATTACK` (0x00ff0010).
 *
 * `DPSrvr::OnMeleeAttack` (DPSrvr.cpp:4131) reads `dwAtkMsg, objid, nParam2,
 * nParam3, fVal` (the last only under `__HACK_1023`, active in v15) and echoes a
 * peer-broadcast swing animation via `g_UserMng.AddMeleeAttack`. `fVal` is an
 * anti-cheat echo of the weapon's `fAttackSpeed` -- verified server-side against
 * the equipped weapon, never re-broadcast.
 *
 * This service is **motion-only**: it validates the target id and broadcasts the
 * swing so peers see the attacker animate. Damage, HP deduction, hit SFX, and
 * death are deferred to the combat system (Tier 0 blocker, PROGRESS.md). The
 * `__HACK_1023` speed check is likewise deferred -- it needs the equipped weapon
 * prop, which arrives with the inventory/stats systems.
 *
 * No WAL (rule 04 -- attacks are not in the journal list until damage lands).
 *
 * ponytail: once combat + stats ship, replace this with the real
 * `SendActMsg` -> `ACTMSG` queue -> damage round-trip, gate target validity via
 * `prj.GetMover(objid)`, and enforce the `fVal == fAttackSpeed` anti-cheat.
 *
 * @module services/meleeAttack
 */

import type { ZoneManager } from '../managers/zone.manager';
import type { CPlayer } from '../entities/player';
import {
  MeleeAttackSerializer, type MeleeAttackFrame,
} from '../net/snapshot/meleeAttack.serializer';
import { VISIBILITY_RADIUS, NULL_ID } from '../net/snapshot/constants';
import type { CombatService } from './combat.service';
import { createLogger } from '@flyff/core/logger';

const logger = createLogger({ module: 'meleeAttack-service' });

export interface MeleeAttackServiceDeps {
  zoneManager: ZoneManager;
  combatService: CombatService;
}

export type MeleeAttackOutcome =
  | { ok: true; reached: number }
  | { ok: false; reason: 'invalid_target' };

export class MeleeAttackService {
  private readonly serializer = new MeleeAttackSerializer();
  constructor(private readonly deps: MeleeAttackServiceDeps) {}

  /**
   * Broadcast the swing animation to zone peers, then run the damage pipeline
   * (`CombatService.resolveAttack`) against the targeted mover. The swing echo
   * always fires so peers see the animation; damage/HP/death follow the
   * server-authoritative `resolveMelee` result.
   */
  attack(player: CPlayer, frame: MeleeAttackFrame): MeleeAttackOutcome {
    if (frame.objid === NULL_ID) {
      return { ok: false, reason: 'invalid_target' };
    }
    const packet = this.serializer.build(player.m_idPlayer, frame);
    const reached = this.deps.zoneManager.broadcastAround(
      player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS, packet,
    );
    // Run the damage round-trip (DAMAGE broadcast + death/exp if lethal).
    const res = this.deps.combatService.resolveAttack(player, frame.objid);
    if (!res.ok) {
      // Visible at default `info` level -- a rejected swing is the #1 "can't
      // kill" symptom (stale objid, peaceful NPC, dead target). Prints the
      // exact reason so a live failure is self-diagnosing.
      logger.warn(
        { charId: player.m_idPlayer, objid: frame.objid, reason: res.reason },
        'melee attack rejected',
      );
    } else if (res.killed) {
      logger.info(
        { charId: player.m_idPlayer, objid: frame.objid, damage: res.damage },
        'melee swing killed mover',
      );
    } else {
      logger.debug(
        { charId: player.m_idPlayer, objid: frame.objid, hit: res.hit, damage: res.damage },
        'melee swing resolved',
      );
    }
    return { ok: true, reached };
  }
}

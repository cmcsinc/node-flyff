/**
 * MeleeAttackService — `PACKETTYPE_MELEE_ATTACK` (0x00ff0010).
 *
 * `DPSrvr::OnMeleeAttack` (DPSrvr.cpp:4131) reads `dwAtkMsg, objid, nParam2,
 * nParam3, fVal` (the last only under `__HACK_1023`, active in v15) and echoes a
 * peer-broadcast swing animation via `g_UserMng.AddMeleeAttack`. `fVal` is an
 * anti-cheat echo of the weapon's `fAttackSpeed` — verified server-side against
 * the equipped weapon, never re-broadcast.
 *
 * This service is **motion-only**: it validates the target id and broadcasts the
 * swing so peers see the attacker animate. Damage, HP deduction, hit SFX, and
 * death are deferred to the combat system (Tier 0 blocker, PROGRESS.md). The
 * `__HACK_1023` speed check is likewise deferred — it needs the equipped weapon
 * prop, which arrives with the inventory/stats systems.
 *
 * No WAL (rule 04 — attacks are not in the journal list until damage lands).
 *
 * ponytail: once combat + stats ship, replace this with the real
 * `SendActMsg` → `ACTMSG` queue → damage round-trip, gate target validity via
 * `prj.GetMover(objid)`, and enforce the `fVal == fAttackSpeed` anti-cheat.
 *
 * @module services/meleeAttack
 */

import type { ZoneManager } from '../managers/zone.manager.js';
import type { CPlayer } from '../entities/player.js';
import {
  MeleeAttackSerializer, type MeleeAttackFrame,
} from '../net/snapshot/meleeAttack.serializer.js';
import { VISIBILITY_RADIUS, NULL_ID } from '../net/snapshot/constants.js';

export interface MeleeAttackServiceDeps {
  zoneManager: ZoneManager;
}

export type MeleeAttackOutcome =
  | { ok: true; reached: number }
  | { ok: false; reason: 'invalid_target' };

export class MeleeAttackService {
  private readonly serializer = new MeleeAttackSerializer();
  constructor(private readonly deps: MeleeAttackServiceDeps) {}

  /** Validate target + broadcast the swing animation to zone peers (no damage). */
  attack(player: CPlayer, frame: MeleeAttackFrame): MeleeAttackOutcome {
    if (frame.objid === NULL_ID) {
      return { ok: false, reason: 'invalid_target' };
    }
    const packet = this.serializer.build(player.m_idPlayer, frame);
    const reached = this.deps.zoneManager.broadcastAround(
      player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS, packet,
    );
    return { ok: true, reached };
  }
}

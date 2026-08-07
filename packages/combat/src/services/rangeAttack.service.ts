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
 * Ammo: v19 bows DO require an equipped arrow. `DoAttackRange`
 * (`_Common/MoverSkill.cpp:3646-3648`) refuses the shot when `PARTS_BULLET` is
 * empty or holds a non-`IK3_ARROW` item, and burns one per swing via
 * `ArrowDown(1)` (`_Common/Mover.cpp:8720`) AFTER `AddRangeAttack`. Because
 * `@flyff/combat` has no `@flyff/inventory` dependency, the gate + burn arrive
 * as injected `hasArrow`/`arrowDown` deps (AmmoService, wired in `compose.ts`);
 * when unwired the shot is not gated (tests / non-player callers).
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

/**
 * `defineText.h:1681` -- `TID_TIP_NEEDSATTACKITEM`, the refusal `CMover::IsBullet`
 * pushes when a bow has no arrow (`_Common/Mover.cpp:8690`). Duplicated here
 * rather than imported: `@flyff/combat` must not depend on `@flyff/inventory`.
 */
export const TID_TIP_NEEDSATTACKITEM = 2608;

export interface RangeAttackServiceDeps {
  zoneManager: ZoneManager;
  combatService: CombatService;
  /** `AmmoService.hasArrow` -- equipped `PARTS_BULLET` is an arrow kind. */
  hasArrow?: (player: CPlayer) => boolean;
  /** `AmmoService.arrowDown` -- burn one arrow + echo UPDATE_ITEM. */
  arrowDown?: (player: CPlayer, count: number) => void;
  /** DEFINEDTEXT push to the shooter (refusal notice). */
  notify?: (player: CPlayer, tid: number) => void;
}

export type RangeAttackOutcome =
  | { ok: true; reached: number }
  | { ok: false; reason: 'invalid_target' | 'no_ranged_weapon' | 'no_arrow' };

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
    // DoAttackRange weapon gate (MoverSkill.cpp:3666): reject if the equipped
    // weapon is not a ranged type. Fires BEFORE the swing broadcast so a
    // spoofed RANGE_ATTACK from a sword/bare-hand player emits nothing.
    if (!this.deps.combatService.isRangedWeaponEquipped(player)) {
      logger.warn(
        { charId: player.m_idPlayer, objid: frame.objid },
        'range attack rejected: no ranged weapon equipped',
      );
      return { ok: false, reason: 'no_ranged_weapon' };
    }
    // Arrow gate (MoverSkill.cpp:3646-3648): equipped PARTS_BULLET must hold an
    // IK3_ARROW stack. Also pre-broadcast, and pushes the same refusal notice
    // `CMover::IsBullet` sends (TID_TIP_NEEDSATTACKITEM).
    if (this.deps.hasArrow && !this.deps.hasArrow(player)) {
      this.deps.notify?.(player, TID_TIP_NEEDSATTACKITEM);
      logger.debug(
        { charId: player.m_idPlayer, objid: frame.objid },
        'range attack rejected: no arrow equipped',
      );
      return { ok: false, reason: 'no_arrow' };
    }
    const packet = this.serializer.build(player.m_idPlayer, frame);    // Exclude the caster: C++ `AddRangeAttack` skips `USERPTR != pMover`. The
    // caster drives its own shot animation locally; echoing back re-queues it
    // (OnRangeAttack) and desyncs auto-attack cadence after a skill. Damage
    // broadcast below still includes the caster.
    const reached = this.deps.zoneManager.broadcastAround(
      player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS, packet, player,
    );
    // `ArrowDown( 1 )` sits immediately after `AddRangeAttack` in DoAttackRange
    // (MoverSkill.cpp:3680) -- burn only once the swing has actually gone out.
    this.deps.arrowDown?.(player, 1);
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

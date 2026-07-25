/**
 * Combat targeting policy -- can `player` attack `mover`?
 *
 * Mirrors the NPC branch of C++ `CMover::IsAttackAbleNPC`
 * (`game/source/_Common/Mover.cpp:6572-6626`):
 *   - peaceful / non-killable (`m_bAttackable == false`) -> never;
 *   - `RANK_GUARD` (`m_bGuard == true`) -> only if the attacker is chaotic/PK
 *     (`MI_GUARDIAN`, `MI_MAFL_PATROL` -- propMover `dwKarma == +2000`);
 *   - `MI_CHAOGUARDIAN` inverse (`m_bChaoGuard == true`, `dwKarma == -2000`) ->
 *     only if the attacker is NON-chaotic.
 *
 * Pure predicate so the future `MELEE_ATTACK` handler reuses the same gate as
 * `TargetService` (which rejects the target lock up front).
 *
 * ponytail: the flying-mismatch branch from C++ (`IsFly()` attacker/target
 * parity) is not modeled -- there is no mount/flight subsystem yet; add the
 * check here when one lands.
 *
 * @module services/combat.policy
 */

import type { CPlayer } from '@flyff/entities';
import type { CMover } from '@flyff/entities';

/**
 * May `player` register `mover` as an attack target?
 * Player-vs-player targeting is out of scope (handled elsewhere).
 */
export function isMoverAttackableBy(player: CPlayer, mover: CMover): boolean {
  if (!mover.m_bAttackable) return false;
  if (mover.m_bGuard && !player.isChaotic()) return false;
  if (mover.m_bChaoGuard && player.isChaotic()) return false;
  return true;
}

/**
 * May `attacker` register `target` (a live player) as a PvP attack target?
 *
 * v15 PvP is consent-gated: both players must have PK mode ON (`m_bPKMode`)
 * for damage to land. A chaotic attacker (already PK) may hit any player
 * who also has PK on -- non-consensual PK is expressed through the PK-value
 * penalty on the kill, not through bypassing the consent gate. A non-PK
 * attacker cannot strike a player at all; the swing is rejected and the
 * client sees the standard "cannot attack" feedback.
 *
 * Dead / stunned / same-player targets are rejected upstream by `resolveTarget`.
 * ponytail: zone region-type enforcement (safe zones reject PvP) + duel
 * handshake (`DUELREQUEST` opcode) for structured 1v1 consent.
 */
export function isPlayerAttackableBy(attacker: CPlayer, target: CPlayer): boolean {
  // Both must have PK mode enabled -- mutual consent.
  if (!attacker.m_bPKMode || !target.m_bPKMode) return false;
  return true;
}

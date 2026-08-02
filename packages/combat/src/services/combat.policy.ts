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
 * @module services/combat.policy
 */

import type { CPlayer } from '@flyff/entities';
import type { CMover } from '@flyff/entities';

/**
 * May `player` register `mover` as an attack target?
 * Player-vs-player targeting is out of scope (handled elsewhere).
 */
export function isMoverAttackableBy(player: CPlayer, mover: CMover): boolean {
  // C++ `CMover::IsAttackAbleNPC` (Mover.cpp:6822-6825): flight is a separate
  // combat plane. A board/broom rider can target only `propMover.bFlying` mobs;
  // ground players cannot target those mobs. `m_bFlyable` is the converted
  // `bFlying` bit, carried through SpawnManager.
  if (player.isFly() !== mover.m_bFlyable) return false;
  if (!mover.m_bAttackable) return false;
  if (mover.m_bGuard && !player.isChaotic()) return false;
  if (mover.m_bChaoGuard && player.isChaotic()) return false;
  return true;
}

/**
 * May `attacker` register `target` (a live player) as a PvP attack target?
 *
 * v19 PvP is consent-gated: both players must have PK mode ON (`m_bPKMode`)
 * for damage to land. A chaotic attacker (already PK) may hit any player
 * who also has PK on -- non-consensual PK is expressed through the PK-value
 * penalty on the kill, not through bypassing the consent gate. A non-PK
 * attacker cannot strike a player at all; the swing is rejected and the
 * client sees the standard "cannot attack" feedback.
 *
 * **Duel override:** an accepted 1v1 duel (`m_nDuel === 1`) bypasses the PK
 * consent gate for the two duelists. The duel handshake is the structured
 * 1v1 consent mechanism; requiring PK mode ON as well made duels unusable
 * in practice.
 *
 * Dead / stunned / same-player targets are rejected upstream by `resolveTarget`.
 * ponytail: zone region-type enforcement (safe zones reject PvP).
 */
export function isPlayerAttackableBy(attacker: CPlayer, target: CPlayer): boolean {
  // `CMover::GetHitType` returns HITTYPE_FAIL before any PvP/duel check when
  // either player flies (`MoverAttack.cpp:1848`, `:1918`). Keep this BEFORE the
  // duel override: a duel grants consent, not aerial melee.
  if (attacker.isFly() || target.isFly()) return false;
  // Duel override -- accepted 1v1 duel pairs are always attackable to each other.
  if (attacker.m_nDuel === 1 && attacker.m_idDuelTarget === target.m_idPlayer) return true;
  if (target.m_nDuel === 1 && target.m_idDuelTarget === attacker.m_idPlayer) return true;
  // Standard PvP: both must have PK mode enabled -- mutual consent.
  if (!attacker.m_bPKMode || !target.m_bPKMode) return false;
  return true;
}

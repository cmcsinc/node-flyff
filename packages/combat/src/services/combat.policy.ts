/**
 * Combat targeting policy -- can `player` attack `mover`?
 *
 * Mirrors the NPC branch of C++ `CMover::IsAttackAbleNPC`
 * (`game/source/_Common/Mover.cpp:6572-6626`):
 *   - peaceful / non-killable (`m_bAttackable == false`) -> never;
 *   - `RANK_GUARD` (`m_bGuard == true`) -> only if the attacker is chaotic/PK
 *     (`MI_GUARDIAN`, `MI_MAFL_PATROL` -- propMover `dwKarma == +2000`).
 *
 * Pure predicate so the future `MELEE_ATTACK` handler reuses the same gate as
 * `TargetService` (which rejects the target lock up front).
 *
 * ponytail: the `MI_CHAOGUARDIAN` inverse (`dwKarma == -2000`, attackable only
 * by *non*-chaotic players) and the flying-mismatch branch from C++ are not yet
 * modeled -- add when the combat system / `nChaotic` field lands.
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
  return mover.m_bAttackable && (!mover.m_bGuard || player.isChaotic());
}

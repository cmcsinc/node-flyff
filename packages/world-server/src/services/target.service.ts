/**
 * TargetService -- `PACKETTYPE_SETTARGET` (0x00ff0023).
 *
 * `DPSrvr::OnSetTarget` (DPSrvr.cpp:4295) reads `OBJID idTarget, BYTE bClear`:
 *   - `bClear == 2` -> `m_idSetTarget = idTarget` (objective marker).
 *   - `bClear == 0` -> claim target's `m_idTargeter` if free.
 *   - `bClear == 1` -> release target's `m_idTargeter` if we own it.
 *
 * The claim/release branches mutate the TARGET's `m_idTargeter`, not ours. The
 * full claim/release bookkeeping lands with `MoverManager`; today we record the
 * player's intent on their own entity for diagnostics AND gate the claim on the
 * combat targeting policy: a non-attackable NPC (peaceful, or a guard while the
 * attacker is not PK) cannot be locked. See `combat.policy.ts` and C++
 * `CMover::IsAttackAbleNPC` (Mover.cpp:6572). ponytail: re-hook this gate into
 * the `MELEE_ATTACK` handler when combat lands.
 *
 * `idTarget` is validated as a DWORD; `bClear` is validated to {0,1,2} per
 * the C++ switch (any other value falls through to no-op).
 *
 * No WAL (target locks are session-scoped, not persisted).
 *
 * @module services/target
 */

import type { CPlayer } from '../entities/player';
import type { SpawnManager } from '../managers/spawn.manager';
import { isMoverAttackableBy } from './combat.policy';
import { NULL_ID } from '../net/snapshot/constants';

export interface TargetServiceDeps {
  spawnManager: SpawnManager;
}

export type SetTargetOutcome =
  | { ok: true; mode: 'set_objective' | 'claim' | 'release' | 'noop' }
  | { ok: false; reason: 'invalid_clear' | 'invalid_target' | 'target_not_attackable' };

export class TargetService {
  private readonly spawnManager: SpawnManager;

  constructor(deps: TargetServiceDeps) {
    this.spawnManager = deps.spawnManager;
  }

  setTarget(player: CPlayer, idTarget: number, bClear: number): SetTargetOutcome {
    if (bClear !== 0 && bClear !== 1 && bClear !== 2) {
      return { ok: false, reason: 'invalid_clear' };
    }
    if (idTarget === NULL_ID && bClear !== 2) {
      return { ok: false, reason: 'invalid_target' };
    }

    if (bClear === 2) {
      player.m_idSetTarget = idTarget;
      player._dirty.add('m_idSetTarget');
      return { ok: true, mode: 'set_objective' };
    }

    if (bClear === 0) {
      // Claim: refuse if the target is a non-attackable mover (peaceful NPC, or
      // a guard while this player is not PK). Player-char targets fall through
      // unchanged -- PvP targeting is out of scope here.
      const mover = this.spawnManager.get(idTarget);
      if (mover !== undefined && !isMoverAttackableBy(player, mover)) {
        return { ok: false, reason: 'target_not_attackable' };
      }
    }

    // ponytail: implement target claim/release against MoverManager.
    // For now record the player's intent on their own entity for diagnostics.
    player.m_idTarget = bClear === 0 ? idTarget : NULL_ID;
    player._dirty.add('m_idTarget');
    return { ok: true, mode: bClear === 0 ? 'claim' : 'release' };
  }
}

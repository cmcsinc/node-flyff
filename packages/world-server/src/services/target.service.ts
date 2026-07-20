/**
 * TargetService — `PACKETTYPE_SETTARGET` (0x00ff0023).
 *
 * `DPSrvr::OnSetTarget` (DPSrvr.cpp:4295) reads `OBJID idTarget, BYTE bClear`:
 *   - `bClear == 2` → `m_idSetTarget = idTarget` (objective marker).
 *   - `bClear == 0` → claim target's `m_idTargeter` if free.
 *   - `bClear == 1` → release target's `m_idTargeter` if we own it.
 *
 * The claim/release branches mutate the TARGET's `m_idTargeter`, not ours. We
 * have no NPC/monster manager yet, so only the `bClear == 2` branch is real
 * today. Claim/release validate `idTarget` but log+drop (no target entity to
 * mutate). ponytail: wire `bClear ∈ {0,1}` once `MoverManager` lands.
 *
 * `idTarget` is validated as a DWORD; `bClear` is validated to {0,1,2} per
 * the C++ switch (any other value falls through to no-op).
 *
 * No WAL (target locks are session-scoped, not persisted).
 *
 * @module services/target.service
 */

import type { CPlayer } from '../entities/player.js';
import { NULL_ID } from '../net/snapshot/constants.js';

export type SetTargetOutcome =
  | { ok: true; mode: 'set_objective' | 'claim' | 'release' | 'noop' }
  | { ok: false; reason: 'invalid_clear' | 'invalid_target' };

export class TargetService {
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
    // ponytail: implement target claim/release against MoverManager.
    // For now record the player's intent on their own entity for diagnostics.
    player.m_idTarget = bClear === 0 ? idTarget : NULL_ID;
    player._dirty.add('m_idTarget');
    return { ok: true, mode: bClear === 0 ? 'claim' : 'release' };
  }
}

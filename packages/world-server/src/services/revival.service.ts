/**
 * RevivalService — `PACKETTYPE_REVIVAL` (0x00ff00c0).
 *
 * `DPSrvr::OnRevival` (DPSrvr.cpp:960) reads no body — it inspects player state.
 * If the player is NOT dead (`pUser->IsDie() == FALSE`), it logs an error and
 * returns. Otherwise it consumes a resurrection scroll from inventory and
 * restarts the player (HP/MP/position restore).
 *
 * We have no death-state machine or inventory yet. Service enforces the IsDie
 * guard: revival is rejected when HP > 0. Dead players are accepted (no-op
 * until inventory+death system lands).
 *
 * No WAL — revive is a state transition derived from existing HP; rule 04 lists
 * only item/exp/gold mutations as journal-worthy.
 *
 * @module services/revival.service
 */

import type { CPlayer } from '../entities/player.js';

export type RevivalOutcome =
  | { ok: true }
  | { ok: false; reason: 'not_dead' };

export class RevivalService {
  /** Request revival. Caller must already be dead. */
  revive(player: CPlayer): RevivalOutcome {
    if (player.m_nHp > 0) return { ok: false, reason: 'not_dead' };
    // ponytail: consume II_SYS_SYS_SCR_RESURRECTION from inventory, restore
    // HP/MP, apply 0.1f exp penalty (C++ SubDieDecExp), revive at current pos.
    return { ok: true };
  }
}

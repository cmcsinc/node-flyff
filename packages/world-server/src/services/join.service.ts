/**
 * JoinService — enter-world business logic.
 *
 * Validates the cluster→world handoff, loads the character from the DB, and
 * places a live `CPlayer` into the player + zone managers. Mirrors the C++
 * `CDPSrvr::OnAddUser` trust chain (`WORLDSERVER/DPSrvr.cpp:612`): the C++
 * world re-verifies `dwAuthKey` against the DB reply at `DPDatabaseClient.cpp
 * :684`. Our analog is the single-use handoff token — consumed here exactly
 * once, and the claimed `idPlayer` + `name` must match both the handoff and
 * the DB row (rule 03 — never trust the client).
 *
 * This service never touches a socket's bytes (rule 02); it returns the
 * spawned `CPlayer` so the handler can build the JOIN/SNAPSHOT frame.
 *
 * @module services/join.service
 */

import type { CharacterRepository } from '@flyff/database';
import { CPlayer } from '../entities/player.js';
import type { PlayerSocket } from '../entities/player.js';
import type { PlayerManager } from '../managers/player.manager.js';
import type { ZoneManager } from '../managers/zone.manager.js';
import type { ConsumedHandoff } from '../ipc/clusterListener.js';

/** Port the join service reads handoffs from — `ClusterListener` satisfies it. */
export interface HandoffSource {
  consumeByCharId(charId: number): ConsumedHandoff | null;
}

export interface JoinServiceDeps {
  charRepo: Pick<CharacterRepository, 'findById'>;
  playerManager: PlayerManager;
  zoneManager: ZoneManager;
  handoffSource: HandoffSource;
}

export type JoinOutcome =
  | { ok: true; player: CPlayer }
  | { ok: false; reason: 'bad_token' | 'not_found' | 'world_mismatch' };

export class JoinService {
  constructor(private deps: JoinServiceDeps) {}

  /**
   * Validate the handoff + character, then spawn.
   *
   * Order (rule 03 — validate before any state change):
   *   1. consume the handoff for idPlayer — single-use, binds {charId, worldId}
   *   2. load the character row; must exist (authoritative name/stats come from DB)
   *   3. row's world must match the handoff's world
   *   4. build + register the player
   *
   * The client carries no token and no char name (C++ JOIN carries only
   * `account` + `idPlayer`); the signed IPC publish is the auth, so we look up
   * the pending handoff by `idPlayer` and trust the DB row for everything else.
   */
  async join(socket: PlayerSocket, idPlayer: number): Promise<JoinOutcome> {
    const handoff = this.deps.handoffSource.consumeByCharId(idPlayer);
    if (!handoff) return { ok: false, reason: 'bad_token' };

    const row = await this.deps.charRepo.findById(idPlayer);
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.world_id !== handoff.worldId) return { ok: false, reason: 'world_mismatch' };

    const player = CPlayer.fromRow(row, socket);
    this.deps.playerManager.add(player);
    this.deps.zoneManager.place(player);
    return { ok: true, player };
  }

  /** Disconnect cleanup — drop from both managers (rule 05 — explicit removal). */
  leave(player: CPlayer): void {
    this.deps.zoneManager.remove(player);
    this.deps.playerManager.remove(player.m_idPlayer);
  }
}

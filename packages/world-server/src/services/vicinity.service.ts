/**
 * VicinityService -- sends a player the live NPC/monster movers for their zone.
 *
 * Server-side spawns materialize once at world-server boot (`SpawnManager.
 * bootstrap()` in `compose.ts`) and are independent of any player. The client
 * is NOTIFIED about the movers in its vicinity only after it has finished
 * loading the world -- triggered by `MAP_KEY` (the first packet Neuz sends
 * after `WORLD_READINFO`/`ReadWorld`, so `g_pWorld` + `g_pPlayer` are set and
 * `CDPClient::OnAddObj` can create the mover models without racing the load).
 *
 * Sending the ADD_OBJ snapshot earlier (bolted onto JOIN) desyncs the client
 * stream and null-derefs `OnAddObj` (`DPClient.cpp:1160`). See memory
 * `v15-npc-addobj-method-exclude-item`.
 *
 * The service builds the packet bytes and hands them to the handler; it never
 * touches a socket (rule 02). `null` return = empty zone, handler skips the
 * write.
 *
 * ponytail: real v15 uses a `CLinkLink`/`CLinkMap` visibility grid and streams
 * AddObj entries as movers enter/leave a player's view radius -- not the whole
 * zone at once. Swap `inZone(zoneId)` for a `withinRadius(pos, r)` query when
 * zones grow large enough that a 43-entry burst is a problem.
 *
 * @module services/vicinity.service
 */

import type { PlayerManager } from '../managers/player.manager';
import type { SpawnManager } from '../managers/spawn.manager';
import type { NpcSnapshotSerializer } from '../net/snapshot/npcSnapshot.serializer';

export interface VicinityServiceDeps {
  playerManager: PlayerManager;
  spawnManager: SpawnManager;
  npcSnapshotSerializer: NpcSnapshotSerializer;
}

export class VicinityService {
  constructor(private deps: VicinityServiceDeps) {}

  /**
   * Build the ADD_OBJ snapshot for every live mover in the player's zone.
   * Returns `null` when the zone is empty OR the vicinity was already sent
   * (one-shot -- caller skips the write), `{ ok:false }` when the player is
   * unknown (session desync -- caller drops).
   */
  enterZone(charId: number): { snapshot: Buffer } | { ok: false; reason: 'no_player' } | null {
    const player = this.deps.playerManager.get(charId);
    if (!player) return { ok: false, reason: 'no_player' };
    if (player.m_vicinitySent) return null; // one-shot: MAP_KEY repeats per .wld
    player.m_vicinitySent = true;
    const movers = this.deps.spawnManager.inZone(player.m_nZoneId);
    if (movers.length === 0) return null;
    return { snapshot: this.deps.npcSnapshotSerializer.build(movers) };
  }
}

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
 * `v19-npc-addobj-method-exclude-item`.
 *
 * The service builds the packet bytes and hands them to the handler; it never
 * touches a socket (rule 02). `null` return = empty zone, handler skips the
 * write.
 *
 * ponytail: real v19 uses a `CLinkLink`/`CLinkMap` visibility grid and streams
 * AddObj entries as movers enter/leave a player's view radius -- not the whole
 * zone at once. Swap `inZone(zoneId)` for a `withinRadius(pos, r)` query when
 * zones grow large enough that a 43-entry burst is a problem.
 *
 * @module services/vicinity.service
 */

import { createLogger } from '@flyff/core/logger';
import type { CMover, CPlayer, Vec3 } from '@flyff/entities';
import { MINIMAP_VIEW_RADIUS } from '@flyff/world-core';
import type { PlayerManager } from '@flyff/world-core';
import type { SpawnManager } from '@flyff/world-core';
import type { NpcSnapshotSerializer } from '../net/snapshot/npcSnapshot.serializer';

const logger = createLogger({ module: 'vicinity' });

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
    return this.buildSnapshot(player);
  }

  /**
   * Re-emit the ADD_OBJ snapshot for the player's CURRENT position, bypassing
   * the one-shot guard. Used after same-world teleport (SETPOS): C++ streams
   * AddObj/RemoveObj deltas via `CLinkMap::ModifyView` on the next world tick
   * (`_Common/World.cpp:1518`), but this emulator has no visibility grid -- the
   * snapshot is the whole zone within the minimap radius. Re-sending is crash-
   * safe: `CDPClient::OnAddObj` (`DPClient.cpp:1071`) dedups an already-known
   * objid into a throwaway and returns. Returns `null` for unknown player or
   * empty vicinity (caller skips).
   *
   * ponytail: stale movers from the old position are NOT removed (no DEL_OBJ
   * diff) -- the client keeps them in its scene but its view frustum culls
   * them at distance. Swap for a cell-grid delta stream (`CLinkMap::ModifyView`
   * port) when that matters.
   */
  resendAt(charId: number): { snapshot: Buffer } | null {
    const player = this.deps.playerManager.get(charId);
    if (!player) return null;
    return this.buildSnapshot(player);
  }

  /** Shared builder -- zone movers within MINIMAP_VIEW_RADIUS of the player. */
  private buildSnapshot(player: CPlayer): { snapshot: Buffer } | null {
    const movers = this.deps.spawnManager.inZone(player.m_nZoneId);
    const nearby = withinRadius(movers, player.m_vPos, MINIMAP_VIEW_RADIUS);
    logger.info(
      { charId: player.m_idPlayer, zoneId: player.m_nZoneId, total: movers.length, sent: nearby.length, radius: MINIMAP_VIEW_RADIUS },
      'vicinity burst',
    );
    if (nearby.length === 0) return null;
    return { snapshot: this.deps.npcSnapshotSerializer.build(nearby) };
  }
}

/** Ground-plane (x/z) circular distance filter -- matches the navigator HUD. */
function withinRadius(movers: readonly CMover[], origin: Vec3, radius: number): CMover[] {
  const r2 = radius * radius;
  const out: CMover[] = [];
  for (const m of movers) {
    const dx = m.m_vPos.x - origin.x;
    const dz = m.m_vPos.z - origin.z;
    if (dx * dx + dz * dz <= r2) out.push(m);
  }
  return out;
}

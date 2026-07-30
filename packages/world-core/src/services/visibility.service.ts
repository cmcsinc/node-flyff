/**
 * VisibilityService -- per-player ADD_OBJ / DEL_OBJ delta streaming.
 *
 * Port of `CLinkMap::ModifyView` (`WORLDSERVER/LinkMap.cpp:404`). C++ buckets
 * every object into a grid and, when a player's centre cell changes, diffs the
 * new visibility ring against the old one:
 *
 *   - cells newly in range  -> `PCSetAt` + `AddAddObj` (both directions for
 *     player<->player, one direction for player->NPC: `NPCSetAt` at :464)
 *   - cells that dropped out -> `PCRemoveKey` + `AddRemoveObj` (`User.h:253`)
 *
 * This port keeps the same *contract* -- a per-viewer set of known objids, and
 * symmetric links between players -- but replaces the cell grid with a direct
 * radius query (`ZoneManager.playersNear` / `SpawnManager.inZone` + distance).
 * With one zone per world and a few hundred movers the O(n) scan is cheaper than
 * maintaining the grid; the diff semantics the client depends on are identical.
 *
 * Serializer access is by injected port, not import: this module lives in
 * `world-core`, below both `@flyff/npc` (NPC frames) and `@flyff/world-server`
 * (peer-player frames), so it cannot depend on either.
 *
 * `refresh` is a no-op until `m_vicinitySent` is set by the first MAP_KEY --
 * before that the client has not finished `WORLD_READINFO`/`ReadWorld` and
 * `CDPClient::OnAddObj` (`DPClient.cpp:1160`) null-derefs on any ADD_OBJ. See
 * memory `v19-npc-addobj-method-exclude-item`.
 *
 * ponytail: monster movement does not re-link. Only player movement, teleport,
 * and spawn/despawn drive a diff, so a monster that walks out of a player's ring
 * keeps its client-side model until the player themselves moves. The 30 m leash
 * (`ai.system.ts`) bounds the error. Port the non-player branch of ModifyView
 * (`LinkMap.cpp:559`) if mobs ever roam further than the visibility radius.
 *
 * @module services/visibility.service
 */

import type { CMover, CPlayer, Vec3 } from '@flyff/entities';
import type { PlayerManager } from '../managers/player.manager';
import type { SpawnManager } from '../managers/spawn.manager';
import type { ZoneManager } from '../managers/zone.manager';
import { VISIBILITY_RADIUS } from '../snapshot-constants';

export interface VisibilityServiceDeps {
  playerManager: PlayerManager;
  zoneManager: ZoneManager;
  spawnManager: SpawnManager;
  /** SNAPSHOT/ADD_OBJ batch for NPC/monster movers (`NpcSnapshotSerializer.build`). */
  buildAddMovers: (movers: readonly CMover[]) => Buffer;
  /** SNAPSHOT/ADD_OBJ batch for peer players (`PeerSnapshotSerializer.build`). */
  buildAddPeers: (players: readonly CPlayer[]) => Buffer;
  /** SNAPSHOT/DEL_OBJ batch (`PeerSnapshotSerializer.buildRemove`). */
  buildRemove: (objids: readonly number[]) => Buffer;
  /** View radius override (tests). Defaults to {@link VISIBILITY_RADIUS}. */
  radius?: number;
  /**
   * Minimum ground-plane distance a player must travel before a diff runs.
   * Stands in for C++'s `nCenter == nOldCenter` early-out (`LinkMap.cpp:380`):
   * without it every 30 Hz movement packet would rescan the zone. Defaults to
   * {@link REFRESH_STEP}.
   */
  step?: number;
}

/**
 * Re-diff granularity, in world units. The C++ static-link grid cell is
 * `4 * MPU` units wide (`fStaticGrid[0]`, LinkMap.cpp:16) and a diff runs only
 * on a cell change; 16 is that cell at MPU 4, so a player crossing one cell
 * triggers at most one rescan. Small enough that a mover is streamed in well
 * before it can be drawn (`VISIBILITY_RADIUS` 200 >> 16).
 */
export const REFRESH_STEP = 16;

export class VisibilityService {
  private readonly radius: number;
  private readonly stepSq: number;
  /** charId -> position the last diff ran at (the `m_nOldCenter` analog). */
  private readonly lastDiffAt = new Map<number, Vec3>();

  constructor(private readonly deps: VisibilityServiceDeps) {
    this.radius = deps.radius ?? VISIBILITY_RADIUS;
    const step = deps.step ?? REFRESH_STEP;
    this.stepSq = step * step;
  }

  /**
   * First MAP_KEY: the client has finished `WORLD_READINFO`/`ReadWorld`, so
   * ADD_OBJ is now safe. Flips the one-shot `m_vicinitySent` gate and streams
   * the initial view. Returns `false` when the player is unknown (session
   * desync -- the caller drops the socket); repeat MAP_KEYs (one per `.wld`)
   * return `true` without re-sending, since `m_known` already covers the view.
   */
  enterWorld(charId: number): boolean {
    const player = this.deps.playerManager.get(charId);
    if (!player) return false;
    if (player.m_vicinitySent) return true;
    player.m_vicinitySent = true;
    this.runDiff(player);
    return true;
  }

  /**
   * Recompute `charId`'s view and stream the difference. Sends at most one
   * ADD_OBJ batch and one DEL_OBJ batch to the viewer, plus a 1-entry batch to
   * each peer whose link to the viewer changed (C++ does the same symmetric
   * pair at `LinkMap.cpp:403-407`).
   *
   * Skipped when the player has not moved a full {@link REFRESH_STEP} since the
   * last diff -- the movement path calls this on every 30 Hz packet. Pass
   * `force` (teleport) to diff regardless.
   */
  refresh(charId: number, force = false): void {
    const viewer = this.deps.playerManager.get(charId);
    if (!viewer || !viewer.m_vicinitySent) return;
    if (!force) {
      const last = this.lastDiffAt.get(charId);
      if (last && distSq2(last, viewer.m_vPos) < this.stepSq) return;
    }
    this.runDiff(viewer);
  }

  /** Run both link diffs and record the position they ran at. */
  private runDiff(viewer: CPlayer): void {
    this.lastDiffAt.set(viewer.m_idPlayer, { ...viewer.m_vPos });
    this.diffPeers(viewer);
    this.diffMovers(viewer);
  }

  /**
   * Drop `player` from every peer's scene and clear their own view. Called from
   * the disconnect hook -- C++ reaches the same state through `IsDelete()` +
   * `CLinkMap::Remove`.
   */
  remove(player: CPlayer): void {
    const removal = this.deps.buildRemove([player.m_idPlayer]);
    for (const peer of this.deps.playerManager.all()) {
      if (peer === player) continue;
      if (peer.m_known.delete(player.m_idPlayer)) {
        this.deps.playerManager.sendTo(peer, removal);
      }
    }
    player.m_known.clear();
    this.lastDiffAt.delete(player.m_idPlayer);
  }

  /**
   * A mover (re)spawned: push ADD_OBJ to players in range that don't know it.
   * Replaces the blind zone broadcast -- a blind send left the objid out of
   * `m_known`, so the next refresh re-sent it.
   */
  onMoverSpawn(mover: CMover): void {
    const packet = this.deps.buildAddMovers([mover]);
    for (const p of this.deps.zoneManager.playersNear(mover.m_vPos, mover.m_nZoneId, this.radius)) {
      if (!p.m_vicinitySent || p.m_known.has(mover.m_idMover)) continue;
      p.m_known.add(mover.m_idMover);
      this.deps.playerManager.sendTo(p, packet);
    }
  }

  /** A mover despawned (corpse cleanup / admin kill): DEL_OBJ to everyone who knows it. */
  onMoverDespawn(mover: CMover): void {
    const packet = this.deps.buildRemove([mover.m_idMover]);
    for (const p of this.deps.playerManager.all()) {
      if (p.m_known.delete(mover.m_idMover)) {
        this.deps.playerManager.sendTo(p, packet);
      }
    }
  }

  /** Player<->player links: symmetric add/remove, mirroring LinkMap.cpp:403-437. */
  private diffPeers(viewer: CPlayer): void {
    const inRange = new Set<number>();
    const added: CPlayer[] = [];

    for (const peer of this.deps.zoneManager.playersNear(viewer.m_vPos, viewer.m_nZoneId, this.radius, viewer)) {
      inRange.add(peer.m_idPlayer);
      if (viewer.m_known.has(peer.m_idPlayer)) continue;
      viewer.m_known.add(peer.m_idPlayer);
      added.push(peer);
      // Reverse link -- the peer learns about the viewer in the same pass.
      if (peer.m_vicinitySent && !peer.m_known.has(viewer.m_idPlayer)) {
        peer.m_known.add(viewer.m_idPlayer);
        this.deps.playerManager.sendTo(peer, this.deps.buildAddPeers([viewer]));
      }
    }

    const dropped: number[] = [];
    for (const objid of viewer.m_known) {
      if (inRange.has(objid)) continue;
      const peer = this.deps.playerManager.get(objid);
      if (!peer) continue; // not a player id -- an NPC/monster, handled by diffMovers
      dropped.push(objid);
      if (peer.m_known.delete(viewer.m_idPlayer)) {
        this.deps.playerManager.sendTo(peer, this.deps.buildRemove([viewer.m_idPlayer]));
      }
    }
    for (const objid of dropped) viewer.m_known.delete(objid);

    if (added.length > 0) {
      this.deps.playerManager.sendTo(viewer, this.deps.buildAddPeers(added));
    }
    if (dropped.length > 0) {
      this.deps.playerManager.sendTo(viewer, this.deps.buildRemove(dropped));
    }
  }

  /** Player->NPC links: one-way (LinkMap.cpp:459-470 sets NPCSetAt, no reverse AddObj). */
  private diffMovers(viewer: CPlayer): void {
    const movers = this.deps.spawnManager.inZone(viewer.m_nZoneId);
    const inRange = new Set<number>();
    const added: CMover[] = [];
    const r2 = this.radius * this.radius;

    for (const m of movers) {
      if (distSq2(m.m_vPos, viewer.m_vPos) > r2) continue;
      inRange.add(m.m_idMover);
      if (viewer.m_known.has(m.m_idMover)) continue;
      viewer.m_known.add(m.m_idMover);
      added.push(m);
    }

    const dropped: number[] = [];
    for (const objid of viewer.m_known) {
      if (inRange.has(objid)) continue;
      if (this.deps.playerManager.get(objid)) continue; // a player -- diffPeers owns it
      dropped.push(objid);
    }
    for (const objid of dropped) viewer.m_known.delete(objid);

    if (added.length > 0) {
      this.deps.playerManager.sendTo(viewer, this.deps.buildAddMovers(added));
    }
    if (dropped.length > 0) {
      this.deps.playerManager.sendTo(viewer, this.deps.buildRemove(dropped));
    }
  }
}

/** Ground-plane (x/z) squared distance -- matches the vicinity/navigator filter. */
function distSq2(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

/**
 * ZoneManager -- zone-scoped spatial broadcast.
 *
 * Rule 05 forbids iterating every connected player. This manager buckets
 * players by `m_nZoneId` and broadcasts only within a bucket, optionally
 * filtered by a 2D ground-plane radius (x/z). The vertical slice ships one
 * zone per world; the bucket model holds when real zones land.
 *
 * @module managers/zone.manager
 */

import type { CPlayer, Vec3 } from '../entities/player';
import { framePacket } from '@flyff/core/net/PacketBuffer';

export class ZoneManager {
  /** zoneId -> live players in that zone. */
  private readonly zones = new Map<number, Set<CPlayer>>();

  /** Register a player into their current zone bucket. */
  place(player: CPlayer): void {
    let bucket = this.zones.get(player.m_nZoneId);
    if (!bucket) {
      bucket = new Set();
      this.zones.set(player.m_nZoneId, bucket);
    }
    bucket.add(player);
  }

  /** Remove a player from whichever zone bucket holds them. */
  remove(player: CPlayer): void {
    const bucket = this.zones.get(player.m_nZoneId);
    bucket?.delete(player);
  }

  /**
   * Broadcast `packet` to every player in `zoneId` whose ground-plane distance
   * from `pos` is <= `radius`. Returns the number of players reached.
   *
   * @param pos   - Origin of the broadcast.
   * @param zoneId - Zone to broadcast in (cross-zone never happens).
   * @param radius - Max ground-plane (x/z) distance, in world units.
   * @param packet - Wire bytes to write to each reached socket.
   * @param except - Optional player to skip (e.g. the originator).
   */
  broadcastAround(
    pos: Vec3,
    zoneId: number,
    radius: number,
    packet: Buffer,
    except?: CPlayer,
  ): number {
    const bucket = this.zones.get(zoneId);
    if (!bucket) return 0;

    // Frame once, reuse for every write -- serializers build raw payloads
    // (opcode + fields); the 0x5E wire frame is added here at the write
    // boundary, same as `sendPacket()` does for direct replies. Writing raw
    // would send unframed garbage the client silently drops.
    const framed = framePacket(packet);
    const r2 = radius * radius;
    let reached = 0;
    for (const p of bucket) {
      if (p === except) continue;
      const dx = p.m_vPos.x - pos.x;
      const dz = p.m_vPos.z - pos.z;
      if (dx * dx + dz * dz <= r2) {
        p.socket.write(framed);
        reached++;
      }
    }
    return reached;
  }

  /**
   * Broadcast `packet` to every player in `zoneId` regardless of distance.
   * Use for zone-wide events (NPC dialogue broadcast, weather, etc.).
   */
  broadcastZone(zoneId: number, packet: Buffer): number {
    const bucket = this.zones.get(zoneId);
    if (!bucket) return 0;
    const framed = framePacket(packet);
    for (const p of bucket) p.socket.write(framed);
    return bucket.size;
  }

  /**
   * Live players in `zoneId` within `radius` (ground-plane x/z) of `pos`.
   * Zone-scoped (rule 05 -- never iterate all players) for AI aggro scans + the
   * future central tick. Optional `except` skips one player (e.g. self).
   */
  playersNear(pos: Vec3, zoneId: number, radius: number, except?: CPlayer): CPlayer[] {
    const bucket = this.zones.get(zoneId);
    if (!bucket) return [];
    const r2 = radius * radius;
    const out: CPlayer[] = [];
    for (const p of bucket) {
      if (p === except) continue;
      const dx = p.m_vPos.x - pos.x;
      const dz = p.m_vPos.z - pos.z;
      if (dx * dx + dz * dz <= r2) out.push(p);
    }
    return out;
  }
}

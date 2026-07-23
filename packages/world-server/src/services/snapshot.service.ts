/**
 * SnapshotService -- handles inbound SNAPSHOT/DESTPOS (click-to-move).
 *
 * `DPSrvr::OnSnapshot` (DPSrvr.cpp:4338) multiplexes `c:BYTE` entries by
 * `wHdr:WORD`; v15 sends only `SNAPSHOTTYPE_DESTPOS`, whose body
 * (`OnPlayerDestPos` DPSrvr.cpp:4364) is `vPos:Vec3 + fForward:BYTE`.
 * (A trailing `objidIAObj:DWORD` exists only `#ifdef __IAOBJ0622`, which is
 * NOT defined in this v15 build.)
 *
 * Server-side anti-teleport (`OnPlayerDestPos:4371`):
 *   D3DXVec3LengthSq( GetPos() - vPos ) > 1000000.0f  => silent drop.
 * That is `distSq > 1e6` (1000 linear units, full 3-D) -- NOT the `MAX_SPEED*1.2`
 * phrasing in CLAUDE.md (aspirational, not the real C++ check).
 *
 * On pass: update `m_vPos` (dirty), broadcast a SNAPSHOT/DESTPOS echo to zone
 * peers via `ZoneManager.broadcastAround`. No WAL -- position is checkpoint-saved
 * every 30s (rule 04). No sender reply.
 *
 * @module services/snapshot.service
 */

import type { ZoneManager } from '@flyff/world-core';
import type { Vec3 } from '@flyff/entities';
import type { CPlayer } from '@flyff/entities';
import {
  DestPosSerializer, type DestPosFrame,
} from '../net/snapshot/destPos.serializer';
import { VISIBILITY_RADIUS } from '../net/snapshot/constants';

export interface SnapshotServiceDeps {
  zoneManager: ZoneManager;
}

export type DestPosOutcome =
  | { ok: true; reached: number }
  | { ok: false; reason: 'too_far' };

/** `D3DXVec3LengthSq > 1_000_000` => drop (OnPlayerDestPos:4371). */
const ANTI_TELEPORT_SQ = 1_000_000;

export class SnapshotService {
  private readonly destPosSerializer = new DestPosSerializer();
  constructor(private readonly deps: SnapshotServiceDeps) {}

  /**
   * Apply a DESTPOS (click-to-move) for `player`. Silently drops teleport-class
   * jumps; otherwise updates position and echoes to peers.
   */
  destPos(player: CPlayer, frame: DestPosFrame): DestPosOutcome {
    if (distSq3(player.m_vPos, frame.vPos) > ANTI_TELEPORT_SQ) {
      return { ok: false, reason: 'too_far' };
    }
    player.m_vPos = { ...frame.vPos };
    player._dirty.add('m_vPos');

    const packet = this.destPosSerializer.build(player.m_idPlayer, frame);
    const reached = this.deps.zoneManager.broadcastAround(
      player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS, packet, player,
    );
    return { ok: true, reached };
  }
}

/** Full 3-D squared distance (matches C++ `D3DXVec3LengthSq`). */
function distSq3(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * MovementService -- PLAYERMOVED + PLAYERBEHAVIOR (60-byte movement/motion frame).
 *
 * Both packets share an identical wire body (`DPSrvr.cpp:2271 OnPlayerMoved`,
 * `DPSrvr.cpp:2349 OnPlayerBehavior`): `v, vd, f, dwState, dwStateFlag, dwMotion,
 * nMotionEx, nLoop, dwMotionOption, nTickCount(__int64)`.
 *
 * `applyMovement` runs the verified anti-teleport guard
 * (`D3DXVec3LengthSq(GetPos() - v) > 1e6` => drop, same threshold as DESTPOS),
 * updates `m_vPos`, and echoes a `SNAPSHOTTYPE_MOVERMOVED` broadcast to peers.
 *
 * `applyBehavior` only echoes a `SNAPSHOTTYPE_MOVERBEHAVIOR` broadcast -- it does
 * NOT mutate server-side position. Behavior frames (sit/stand/cast) carry a
 * position for the client animation, but authoritative position is owned by
 * PLAYERMOVED/DESTPOS; mutating here would snap players on every motion packet.
 * No verified C++ guard exists for OnPlayerBehavior, so none is applied.
 *
 * No WAL (position checkpoints every 30s, rule 04). No sender reply.
 *
 * Death lockout: every apply path early-returns `{ ok: false, reason: 'dead' }`
 * when `player.m_bDead` (`CMover::IsDie()` gate -- a corpse cannot walk or echo
 * motion). The attack + skill-cast paths gate the same flag independently.
 * ponytail: per-socket 30 Hz rate-limit once `rateLimit.ts` lands (rule 03).
 *
 * @module services/movement.service
 */

import type { ZoneManager } from '@flyff/world-core';
import type { Vec3 } from '@flyff/entities';
import type { CPlayer } from '@flyff/entities';
import {
  MoverBroadcastSerializer, type MovementFrame, type Movement2Frame,
} from '../net/snapshot/moverBroadcast.serializer';
import { DestObjSerializer } from '@flyff/combat';
import { VISIBILITY_RADIUS, NULL_ID } from '@flyff/world-core';
import type { VisibilityService } from '@flyff/world-core';
import type { LootService } from '@flyff/inventory';

export interface MovementServiceDeps {
  zoneManager: ZoneManager;
  /**
   * Optional position-change hook (Phase 7 -- wired to
   * `QuestTrackerSystem.onPlayerMoved` for `SetEndCondPatrolZone`). Invoked
   * after every accepted pos mutation so reactive quest conditions can test
   * the new position against their patrol rects.
   */
  onMoved?: (player: CPlayer) => void;
  /**
   * Ground-item pickup trigger. v19 has no pickup packet: the client walks to a
   * pile via `PLAYERSETDESTOBJ` and the server loots on arrival. Hooked here so
   * every accepted position update re-checks `m_idDestObj` range. Optional so
   * tests/standalone movement can omit it.
   */
  lootService?: LootService;
  /**
   * View re-diff hook (`CLinkMap::ModifyView`, LinkMap.cpp:404). C++ calls it
   * from `CMover::SetPos` on every position change; every accepted movement path
   * here does the same so peers and movers stream in/out of view as the player
   * walks. Optional so bare movement tests can omit it.
   */
  visibilityService?: Pick<VisibilityService, 'refresh'>;
}

export type MovementOutcome =
  | { ok: true; reached: number }
  | { ok: false; reason: 'too_far' | 'dead' };

export type GetPosOutcome =
  | { ok: true }
  | { ok: false; reason: 'too_far' | 'nan_angle' };

/** `D3DXVec3LengthSq > 1_000_000` => drop (OnPlayerMoved, same as DESTPOS). */
const ANTI_TELEPORT_SQ = 1_000_000;

/** Dead lockout -- a corpse cannot move or echo motion (`CMover::IsDie()` gate). */
const DEAD: MovementOutcome = { ok: false, reason: 'dead' };

/** C++ `MAX_CORR_SIZE_150`-style frame cap for PLAYERMOVED2 -- not enforced today. */
// const MAX_CORR_SIZE_150 = 150;

export class MovementService {
  private readonly serializer = new MoverBroadcastSerializer();
  private readonly destObjSerializer = new DestObjSerializer();
  constructor(private readonly deps: MovementServiceDeps) {}

  /** Apply a PLAYERMOVED frame: anti-teleport, update pos, echo to peers. */
  applyMovement(player: CPlayer, frame: MovementFrame): MovementOutcome {
    if (player.m_bDead) return DEAD;
    if (distSq3(player.m_vPos, frame.v) > ANTI_TELEPORT_SQ) {
      return { ok: false, reason: 'too_far' };
    }
    player.m_vPos = { ...frame.v };
    player._dirty.add('m_vPos');
    this.deps.onMoved?.(player);
    this.deps.lootService?.checkArrival(player);
    this.clearDestObj(player);
    this.deps.visibilityService?.refresh(player.m_idPlayer);
    return this.broadcast(player, this.serializer.buildMoved(player.m_idPlayer, frame));
  }

  /** Apply a PLAYERBEHAVIOR frame: echo motion to peers (no position mutation). */
  applyBehavior(player: CPlayer, frame: MovementFrame): MovementOutcome {
    if (player.m_bDead) return DEAD;
    return this.broadcast(player, this.serializer.buildBehavior(player.m_idPlayer, frame));
  }

  /**
   * Apply a PLAYERCORR frame (DPSrvr.cpp:2651 OnPlayerCorr). Anti-teleport guard
   * applies only when not flying (we don't model flight yet). On pass: update
   * pos, echo MOVERCORR to peers.
   */
  applyCorr(player: CPlayer, frame: MovementFrame): MovementOutcome {
    if (player.m_bDead) return DEAD;
    if (distSq3(player.m_vPos, frame.v) > ANTI_TELEPORT_SQ) {
      return { ok: false, reason: 'too_far' };
    }
    player.m_vPos = { ...frame.v };
    player._dirty.add('m_vPos');
    this.deps.onMoved?.(player);
    this.deps.lootService?.checkArrival(player);
    this.clearDestObj(player);
    this.deps.visibilityService?.refresh(player.m_idPlayer);
    return this.broadcast(player, this.serializer.buildCorr(player.m_idPlayer, frame));
  }

  /**
   * Apply a PLAYERMOVED2 frame (DPSrvr.cpp:2397 OnPlayerMoved2). 73-byte body.
   * C++ only acts when flying; we always broadcast (no flight model yet).
   * ponytail: gate on `player.m_pActMover?.IsFly()` once flight state exists.
   */
  applyMoved2(player: CPlayer, frame: Movement2Frame): MovementOutcome {
    if (player.m_bDead) return DEAD;
    if (distSq3(player.m_vPos, frame.v) > ANTI_TELEPORT_SQ) {
      return { ok: false, reason: 'too_far' };
    }
    player.m_vPos = { ...frame.v };
    player._dirty.add('m_vPos');
    this.deps.onMoved?.(player);
    this.deps.lootService?.checkArrival(player);
    this.deps.visibilityService?.refresh(player.m_idPlayer);
    return this.broadcast(player, this.serializer.buildMoved2(player.m_idPlayer, frame));
  }

  /**
   * Apply a PLAYERANGLE frame (DPSrvr.cpp:2513 OnPlayerAngle). 45-byte body --
   * `v, vd, f, fAngleX, fAccPower, fTurnAngle, nTickCount`. C++ only acts when
   * flying. No `g_UserMng.Add*` call in the source -- server-side state only.
   * We accept + log without broadcast (no peer-visible effect documented).
   */
  applyAngle(_player: CPlayer, _now: number): MovementOutcome {
    // ponytail: implement flight correction once ActMover/flight state exists.
    return { ok: true, reached: 0 };
  }

  /**
   * Apply a GETPOS frame (DPSrvr.cpp:1416 OnGetPos) -- authoritative position
   * report from client. NaN guard on `fAngle`, anti-teleport on `vPos`, then
   * store on player. When `objid == NULL_ID`, C++ accepts the position as the
   * player's own (the only path v19 uses).
   */
  applyGetPos(player: CPlayer, pos: Vec3, fAngle: number, objid: number): GetPosOutcome {
    if (Number.isNaN(fAngle)) return { ok: false, reason: 'nan_angle' };
    if (distSq3(player.m_vPos, pos) > ANTI_TELEPORT_SQ) {
      return { ok: false, reason: 'too_far' };
    }
    if (objid === NULL_ID) {
      player.m_vPos = { ...pos };
      player.m_fAngle = fAngle;
      player._dirty.add('m_vPos');
      player._dirty.add('m_fAngle');
      this.deps.lootService?.checkArrival(player);
      this.deps.visibilityService?.refresh(player.m_idPlayer);
    }
    return { ok: true };
  }

  /**
   * Apply a PLAYERSETDESTOBJ frame (DPSrvr.cpp:2598 OnPlayerSetDestObj). Server
   * records the destination obj id + stop range and echoes MOVERSETDESTOBJ to
   * vicinity peers, which then run their own pathfinding to the object (NO
   * position is sent).
   *
   * NO `__TRAFIC_1222` dedup (`GetDestId() == objid -> return`). That guard is
   * safe in C++ only because the world server *simulates* the walk
   * (`CMover::Process` -> `ProcessMove`, `_Common/MoverMove.cpp:354`) and clears
   * `m_idDest` itself on arrival (`ProcessMoveArrival`, `MoverMove.cpp:341`), so
   * a client re-issue never matches the stored dest. We have no server-side
   * movement simulation, so `m_idDestObj` would stay pinned at the target and
   * swallow every re-issue.
   *
   * That matters because follow is re-issue-driven: the client clears its own
   * `m_idDest` on arrival (`MoverMove.cpp:267`) and re-sends every frame the
   * leader is further than `distSq > 16` (`WndWorldControlPlayer.cpp:405-416`),
   * gated on `m_idDest != objid` (`MoverMsg.cpp:52`). A duplicate PLAYERSETDESTOBJ
   * is therefore *evidence the follower arrived*, not redundant traffic --
   * dropping it froze the follow on every observer's screen after the first hop
   * while the follower's own client kept walking.
   *
   * ponytail: restore the dedup once `ProcessMove`/`ProcessMoveArrival` are
   * ported and the server clears `m_idDestObj` on arrival by itself.
   */
  applySetDestObj(player: CPlayer, destObjid: number, fRange: number): MovementOutcome {
    player.m_idDestObj = destObjid;
    player.m_fArrivalRange = fRange;
    // v19 pickup has no packet -- check immediately in case the player is already
    // on the pile (click a drop at your feet). Otherwise `onSetDestObj` starts a
    // QUERYGETPOS poll: during a client-driven walk to a dest object the client
    // sends NO movement packet, so no other arrival check would ever fire.
    this.deps.lootService?.onSetDestObj(player);
    if (player.m_idDestObj === NULL_ID) {
      // The pile was looted on contact -- nothing left to walk to, no broadcast.
      return { ok: true, reached: 0 };
    }
    const packet = this.destObjSerializer.build(player.m_idPlayer, destObjid, fRange);
    return this.broadcast(player, packet);
  }

  /**
   * `CMover::SetDestPos` tail (`_Common/MoverMsg.cpp:105`) -- taking a position
   * destination clears the object destination; the two are mutually exclusive.
   *
   * C++ reaches it on the normal-latency branch of `OnPlayerMoved`
   * (`SetDestPos(v, ...)`, DPSrvr.cpp:2367) and unconditionally in
   * `OnPlayerCorr` (`ClearDest()`, DPSrvr.cpp:2719). The high-latency branch
   * instead runs `ActionForceSet`, which under `__SYNC_1217` -- set in this build
   * (`WORLDSERVER/VersionCommon.h:190`) -- clears only the *position* dest
   * (`MoverParam.cpp:3498`). We model neither `delay` nor `MAX_CORR_SIZE_45`, so
   * we always clear: the client has already dropped its own dest before it can
   * send a movement frame (`ClearDest()` on `fMoved || fBehavior`,
   * `WndWorldControlPlayer.cpp:548`), so clearing on every accepted frame agrees
   * with the client either way.
   *
   * Without this a stale `m_idDestObj` survives a manual walk away and gets
   * reported to late-arriving observers by QUERYGETDESTOBJ, rendering a phantom
   * follow. `applyBehavior` deliberately does NOT clear -- C++ routes
   * `OnPlayerBehavior` only through `ActionForceSet`.
   */
  private clearDestObj(player: CPlayer): void {
    player.m_idDestObj = NULL_ID;
    player.m_fArrivalRange = 0;
  }

  private broadcast(player: CPlayer, packet: Buffer): MovementOutcome {
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

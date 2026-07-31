/**
 * CheerService -- `PACKETTYPE_CHEERING` (0xffffff7c).
 *
 * `DPSrvr::OnCheering` (`WORLDSERVER/DPSrvr.cpp:7068`), in order:
 *
 *   ar >> objid;
 *   if( pUser->GetId() == objid ) return;                 // no self-cheer
 *   CMover* pTarget = prj.GetMover( objid );
 *   if( valid && OT_MOVER && IsPlayer() ) {
 *     if( pUser->m_nCheerPoint <= 0 ) {
 *       pUser->AddDefinedText( TID_CHEER_NO1, "%d",
 *                              (pUser->m_dwTickCheer - dwTickCount) / 60000 );
 *       return;
 *     }
 *     if( pUser->m_nCheerPoint == MAX_CHEERPOINT )
 *       SetCheerParam( n-1, dwTickCount, TICK_CHEERPOINT );      // fresh 60 min
 *     else
 *       SetCheerParam( n-1, dwTickCount, m_dwTickCheer - dwTickCount ); // keep
 *     SetAngle( GetDegree( pTarget->GetPos(), pUser->GetPos() ) );
 *     same-sex  -> target TID_CHEER_MESSAGE3, cheerer MTI_CHEERSAME
 *     diff-sex  -> target TID_CHEER_MESSAGE4, cheerer MTI_CHEEROTHER
 *     AddCreateSfxObj( pUser, XI_CHEERSENDEFFECT );
 *     AddCreateSfxObj( pTarget, XI_CHEERRECEIVEEFFECT );
 *     AddMoverBehavior( ..., fTransferToMe = TRUE );      // echoes to cheerer
 *     pTarget->DoApplySkill( pTarget, GetItemProp(II_CHEERUP), NULL );
 *   } else
 *     pUser->AddDefinedText( TID_CHEER_NO2, "" );
 *
 * Two details that are easy to get wrong and are ported deliberately:
 *  - **The two SetCheerParam branches are NOT interchangeable.** Spending from a
 *    full stock starts a fresh 60-minute timer; spending from a partial stock
 *    preserves whatever time was already elapsed. Collapsing them would let a
 *    player reset their own regen clock backwards.
 *  - **`fTransferToMe = TRUE`** on the behavior broadcast, unlike every other
 *    movement broadcast which skips the origin. The cheerer must receive it to
 *    apply the new facing angle.
 *
 * The point regen tick is `CMover::CheckTickCheer` (`Mover.cpp:9069`), driven
 * here by {@link CheerService.tick} from the recovery loop.
 *
 * Cheer points are **not persisted** -- C++ resets them to 0 with a full timer
 * on load (`DPDatabaseClient.cpp:725`) and strips the II_CHEERUP buff
 * (line 744). No WAL (rule 04).
 *
 * @module services/cheer.service
 */

import type { PlayerManager, ZoneManager } from '@flyff/world-core';
import { VISIBILITY_RADIUS } from '@flyff/world-core';
import type { CPlayer, Vec3, DstEffect } from '@flyff/entities';
import {
  MAX_CHEERPOINT, TICK_CHEERPOINT_MS, MTI_CHEERSAME, MTI_CHEEROTHER,
  XI_CHEERSENDEFFECT, XI_CHEERRECEIVEEFFECT, II_CHEERUP, CHEERUP_DURATION_MS,
  TID_CHEER_MESSAGE3, TID_CHEER_MESSAGE4, TID_CHEER_NO1, TID_CHEER_NO2,
} from '@flyff/entities';
import { buildSetCheerParam, buildCreateSfxObj } from '../net/snapshot/cheer.serializer';
import { buildDefinedText } from '../net/snapshot/notice.serializer';
import { MotionSerializer } from '../net/snapshot/motion.serializer';

export interface CheerServiceDeps {
  playerManager: PlayerManager;
  zoneManager: ZoneManager;
  /**
   * `prj.GetItemProp(II_CHEERUP)` equivalent -- resolves the virtual buff item.
   * `chg` is optional-and-possibly-undefined on the resource shape, hence the
   * widened effect type rather than `DstEffect` directly.
   */
  getItemProp?: (id: number) => {
    effects?: readonly { dst: number; adj: number; chg?: number | undefined }[];
    duration?: number | undefined;
  } | undefined;
}

export type CheerOutcome =
  | { ok: true; pointsLeft: number }
  | { ok: false; reason: 'self' | 'not-player' | 'no-points' };

export class CheerService {
  private readonly motionSerializer = new MotionSerializer();
  constructor(private readonly deps: CheerServiceDeps) {}

  /** Cheer `targetObjid`. Spends one point; no-ops (with a notice) when broke. */
  cheer(player: CPlayer, targetObjid: number, now = Date.now()): CheerOutcome {
    if (player.m_idPlayer === targetObjid) return { ok: false, reason: 'self' };

    const target = this.deps.playerManager.get(targetObjid);
    if (!target) {
      // C++ passes an empty arg string here, not the arg-less overload.
      this.send(player, buildDefinedText(player.m_idPlayer, TID_CHEER_NO2, ''));
      return { ok: false, reason: 'not-player' };
    }

    if (player.m_nCheerPoint <= 0) {
      const minutes = Math.floor(Math.max(0, player.m_dwTickCheer - now) / 60_000);
      this.send(player, buildDefinedText(player.m_idPlayer, TID_CHEER_NO1, String(minutes)));
      return { ok: false, reason: 'no-points' };
    }

    // Full stock -> fresh timer; partial -> preserve remaining. See module doc.
    const rest = player.m_nCheerPoint === MAX_CHEERPOINT
      ? TICK_CHEERPOINT_MS
      : Math.max(0, player.m_dwTickCheer - now);
    this.setCheerParam(player, player.m_nCheerPoint - 1, now, rest);

    player.m_fAngle = getDegree(target.m_vPos, player.m_vPos);

    const sameSex = target.m_nSex === player.m_nSex;
    this.send(target, buildDefinedText(
      target.m_idPlayer,
      sameSex ? TID_CHEER_MESSAGE3 : TID_CHEER_MESSAGE4,
      player.m_szName,
    ));
    // SendActMsg(OBJMSG_MOTION, mti) -> AddMotion to the vicinity.
    this.broadcast(player, this.motionSerializer.build(
      player.m_idPlayer, sameSex ? MTI_CHEERSAME : MTI_CHEEROTHER,
    ));

    // Both SFX go to the visibility range INCLUDING the anchor mover.
    this.broadcast(player, buildCreateSfxObj(player.m_idPlayer, XI_CHEERSENDEFFECT));
    this.broadcast(target, buildCreateSfxObj(target.m_idPlayer, XI_CHEERRECEIVEEFFECT));

    this.applyCheerUp(target, now);
    return { ok: true, pointsLeft: player.m_nCheerPoint };
  }

  /**
   * `CMover::CheckTickCheer` (`Mover.cpp:9069`) -- regen one point when the
   * timer elapses, up to MAX_CHEERPOINT. Called per player from the recovery loop.
   *
   * A `m_dwTickCheer` of 0 means the player has not been seeded yet (fresh
   * `CPlayer`); seed a full timer without granting a point, matching the C++
   * load path. Without this the first tick would hand out a free point, since
   * `now > 0` always holds.
   */
  tick(player: CPlayer, now = Date.now()): void {
    if (player.m_dwTickCheer === 0) { this.seedOnJoin(player, now); return; }
    if (player.m_nCheerPoint >= MAX_CHEERPOINT) return;
    if (now <= player.m_dwTickCheer) return;
    this.setCheerParam(player, player.m_nCheerPoint + 1, now, TICK_CHEERPOINT_MS);
  }

  /**
   * Seed a freshly joined player: 0 points, full timer. Mirrors the C++ load
   * path (`DPDatabaseClient.cpp:725`) which discards any stored value.
   */
  seedOnJoin(player: CPlayer, now = Date.now()): void {
    this.setCheerParam(player, 0, now, TICK_CHEERPOINT_MS);
  }

  /**
   * `CMover::SetCheerParam` (`Mover.cpp:9080`). `bAdd` is derived from whether
   * the count went UP -- the client only shows the "point recovered" notice then.
   */
  private setCheerParam(player: CPlayer, points: number, now: number, restMs: number): void {
    const added = player.m_nCheerPoint < points;
    player.m_nCheerPoint = points;
    player.m_dwTickCheer = now + restMs;
    this.send(player, buildSetCheerParam(player.m_idPlayer, points, restMs, added));
  }

  /**
   * `pTarget->DoApplySkill( pTarget, GetItemProp(II_CHEERUP), NULL )` -- the buff
   * is a virtual item, so it rides the existing item-buff path. Falls back to
   * the propItem duration when the resource lookup is unavailable.
   * ponytail: emit SETSKILLSTATE + SETDESTPARAM once the cheer buff's DST
   * effects are present in the item data (v19 `II_CHEERUP` carries none in
   * `propItem.txt:1742`, so today this is a no-op beyond the icon).
   */
  private applyCheerUp(target: CPlayer, now: number): void {
    const prop = this.deps.getItemProp?.(II_CHEERUP);
    const raw = prop?.effects ?? [];
    if (raw.length === 0) return;
    // Normalize: `chg` is optional-and-undefined on the resource shape, but
    // `DstEffect` under exactOptionalPropertyTypes wants the key absent.
    const effects: DstEffect[] = raw.map((e) =>
      e.chg === undefined ? { dst: e.dst, adj: e.adj } : { dst: e.dst, adj: e.adj, chg: e.chg });
    const durationMs = (prop?.duration ?? 0) * 1_000 || CHEERUP_DURATION_MS;
    target.m_buffs.addItemBuff(II_CHEERUP, durationMs, effects, now);
  }

  private send(player: CPlayer, buf: Buffer): void {
    this.deps.playerManager.sendTo(player, buf);
  }

  private broadcast(anchor: CPlayer, buf: Buffer): void {
    this.deps.zoneManager.broadcastAround(anchor.m_vPos, anchor.m_nZoneId, VISIBILITY_RADIUS, buf);
  }
}

/**
 * `GetDegree` (`_Common/Obj.h:288`) -- compass bearing in degrees from `src`
 * toward `dest`, measured against the `VelocityToVec(0,1)` reference `(0,0,-1)`:
 *
 *   vDir1 = (0, 0, -1);  vDir2 = normalize(dest - src) with y zeroed
 *   fDegree = toDegree( acos( dot(vDir1, vDir2) ) )
 *   if( vDir2.x < 0 ) fDegree = 360 - fDegree
 *
 * Kept as an exact port rather than a one-line `atan2`: the C++ value feeds the
 * client's facing directly, and the acos path has different rounding at the
 * poles than an atan2 rewrite would.
 */
export function getDegree(dest: Vec3, src: Vec3): number {
  const dx = dest.x - src.x;
  const dz = dest.z - src.z;
  const len = Math.hypot(dx, dz);
  if (len === 0) return 0;                       // degenerate: same spot
  const nx = dx / len;
  const nz = dz / len;
  // dot((0,0,-1), (nx,0,nz)) = -nz; clamp for acos domain safety.
  const dot = Math.min(1, Math.max(-1, -nz));
  const degree = (Math.acos(dot) * 180) / Math.PI;
  return nx < 0 ? 360 - degree : degree;
}

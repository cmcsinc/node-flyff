/**
 * QueryGetDestObjService -- `PACKETTYPE_QUERYGETDESTOBJ` (0xffffff72).
 *
 * `DPSrvr::OnQueryGetDestObj` (DPSrvr.cpp:1355) reads `OBJID objid`, resolves
 * the mover via `prj.GetMover(objid)`, and -- if the mover has a destination
 * (`!IsEmptyDestObj()`) -- replies with `AddGetDestObj(objid, GetDestId(),
 * m_fArrivalRange)` (User.cpp:2337), a SNAPSHOT/GETDESTOBJ frame sent back to
 * the requester so its client can sync the remote mover's pathfinding target.
 *
 * No reply when the mover is unknown or has no destination -- matches C++.
 *
 * ponytail: `prj.GetMover` resolves ANY mover (player/NPC/monster); we only
 * track players (`PlayerManager`) today, so non-player objids silently no-op
 * until a `MoverManager` lands. Same gap as `QueryGetPosService`.
 *
 * No WAL (pure query, no state mutation).
 *
 * @module services/queryGetDestObj.service
 */

import type { CPlayer } from '@flyff/entities';
import type { PlayerManager } from '@flyff/world-core';
import type { DestObjSerializer } from '../net/snapshot/destObj.serializer';
import { NULL_ID } from '@flyff/world-core';

export interface QueryGetDestObjOutcome {
  /** SNAPSHOT/GETDESTOBJ frame to write back to the requester, if any. */
  reply?: Buffer;
}

export class QueryGetDestObjService {
  constructor(
    private playerManager: PlayerManager,
    private destObjSerializer: DestObjSerializer,
  ) {}

  query(_requester: CPlayer, objid: number): QueryGetDestObjOutcome {
    if (objid === NULL_ID) return {};
    const mover = this.playerManager.get(objid);
    if (!mover) return {};
    if (mover.m_idDestObj === NULL_ID) return {}; // IsEmptyDestObj()
    return {
      reply: this.destObjSerializer.buildGetDestObj(
        objid,
        mover.m_idDestObj,
        mover.m_fArrivalRange,
      ),
    };
  }
}

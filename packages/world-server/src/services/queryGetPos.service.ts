/**
 * QueryGetPosService -- `PACKETTYPE_QUERYGETPOS` (0xffffff08).
 *
 * `DPSrvr::OnQueryGetPos` (DPSrvr.cpp:1393) reads `OBJID objid` and replies:
 *   - If target is not a player -> `AddGetPos(objid, pMover->GetPos(), angle)`
 *     (a S->C GETPOS snapshot with the mover's authoritative position).
 *   - If target IS a player -> `AddQueryGetPos(pUser->GetId())` (asks the target
 *     client to broadcast its own position).
 *
 * No reply to the requester when target is unknown.
 *
 * We have no `MoverManager` yet -- both branches log and drop. ponytail: wire
 * reply once `MoverManager` + `GetPosSerializer` land.
 *
 * No WAL (pure query, no state mutation).
 *
 * @module services/queryGetPos.service
 */

import type { CPlayer } from '../entities/player.js';
import { NULL_ID } from '../net/snapshot/constants.js';

export type QueryGetPosOutcome =
  | { ok: true; replied: false }
  | { ok: false; reason: 'invalid_target' };

export class QueryGetPosService {
  query(player: CPlayer, objid: number): QueryGetPosOutcome {
    if (objid === NULL_ID) return { ok: false, reason: 'invalid_target' };
    // ponytail: look up objid in MoverManager; if non-player, reply GETPOS;
    // if player, send the target a QUERY_GETPOS request.
    return { ok: true, replied: false };
  }
}

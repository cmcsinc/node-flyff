/**
 * MoverFocusService -- `PACKETTYPE_MOVERFOCOUS` (0xffffff2d).
 *
 * `DPSrvr::OnMoverFocus` (`WORLDSERVER/DPSrvr.cpp:2154`):
 *
 *   ar >> uidPlayer;
 *   CUser* pUser  = g_UserMng.GetUser(...);
 *   CUser* pFocus = g_UserMng.GetUserByPlayerID( uidPlayer );
 *   if( valid ) pUser->AddMoverFocus( pFocus );
 *
 * The client only sends it when the clicked object is a player AND
 * `g_pPlayer->IsAuthHigher(AUTH_GAMEMASTER)` (`_Common/World.cpp:352`) -- it is
 * the GM target-inspect path that fills in gold/exp the ADD_OBJ snapshot omits.
 *
 * **Deliberate divergence:** C++ does NOT re-check authority server-side, so a
 * patched client could read any player's gold/exp. We enforce
 * `AUTH_GAMEMASTER` here (rule 03 -- never trust the client). Non-GM requests
 * are dropped silently, exactly as C++ drops an unknown `uidPlayer`.
 *
 * No WAL (read-only, rule 04).
 *
 * @module services/moverFocus.service
 */

import type { PlayerManager } from '@flyff/world-core';
import type { CPlayer } from '@flyff/entities';
import { AUTH, hasAuthority } from '@flyff/entities';
import { MoverFocusSerializer } from '../net/snapshot/moverFocus.serializer';

export interface MoverFocusServiceDeps {
  playerManager: PlayerManager;
}

export type MoverFocusOutcome =
  | { ok: true }
  | { ok: false; reason: 'no-auth' | 'not-found' };

export class MoverFocusService {
  private readonly serializer = new MoverFocusSerializer();
  constructor(private readonly deps: MoverFocusServiceDeps) {}

  /** Reply to `player` with `uidPlayer`'s live gold + within-level exp. */
  focus(player: CPlayer, uidPlayer: number): MoverFocusOutcome {
    if (!hasAuthority(player.m_bAuthority, AUTH.GAMEMASTER)) return { ok: false, reason: 'no-auth' };
    const focus = this.deps.playerManager.get(uidPlayer);
    if (!focus) return { ok: false, reason: 'not-found' };
    const buf = this.serializer.build({
      uidPlayer: focus.m_idPlayer,
      gold: focus.m_nGold,
      exp: focus.m_nExp,
    });
    this.deps.playerManager.sendTo(player, buf);
    return { ok: true };
  }
}

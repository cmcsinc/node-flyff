/**
 * QueryPlayerDataService -- `PACKETTYPE_QUERY_PLAYER_DATA` (0xf000f802).
 *
 * v15 Neuz sends this when its local cache of another player's `sPlayerData` is
 * stale (guild/friend/party windows). C++ `CDPSrvr::OnQueryPlayerData`
 * (`WORLDSERVER/DPSrvr.cpp:1647`) replies via `CUser::AddQueryPlayerData`
 * (`WORLDSERVER/User.cpp:1779`) only when `pPlayerData->data.nVer != nVer`,
 * emitting `SNAPSHOTTYPE_QUERY_PLAYER_DATA` (0x0141):
 *
 *   NULL_ID:DWORD(0xffffffff)  wHdr:WORD(0x0141)  idPlayer:DWORD
 *   szPlayer:String  sPlayerData:12B raw
 *
 * `sPlayerData` (`_Common/playerdata.h:6`, sizeof=12 with MSVC padding):
 *   nJob:BYTE  nLevel:BYTE  nSex:BYTE  pad:BYTE  nVer:int32  uLogin:BYTE  pad:3B
 *
 * STUB: logs the query and returns `{ reply: null }` (no reply). The client
 * tolerates a missing reply -- it keeps its existing cache
 * (`Neuz/DPClient.cpp:13445`). Build the reply in `query()` once the live
 * `nVer`/`szPlayer` are tracked on `CPlayer`.
 *
 * @module services/queryPlayerData.service
 */

import type { PlayerManager } from '../managers/player.manager';

export interface QueryPlayerDataServiceDeps {
  playerManager: PlayerManager;
}

export interface QueryPlayerDataResult {
  /** Snapshot payload to send back to the asker, or null for no reply. */
  reply: Buffer | null;
}

export class QueryPlayerDataService {
  constructor(private deps: QueryPlayerDataServiceDeps) {}

  /**
   * Resolve a peer-data query. Stub: always no-reply.
   *
   * @param _charId - asker's character id (from session).
   * @param idPlayer - target character id the client wants data for.
   * @param _nVer - client's cached `sPlayerData` version for the target.
   */
  query(_charId: number, idPlayer: number, _nVer: number): QueryPlayerDataResult {
    const target = this.deps.playerManager.get(idPlayer);
    // ponytail: real reply needs sPlayerData layout + per-player nVer tracking.
    // Until then no-op -- client keeps its cache. When ready: if target &&
    // target.m_nDataVer !== nVer -> build 0x0141 reply: NULL_ID + wHdr + idPlayer
    // + WriteString(name) + 12B sPlayerData.
    void target;
    return { reply: null };
  }
}

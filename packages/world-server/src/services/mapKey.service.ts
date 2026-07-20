/**
 * MapKeyService — `PACKETTYPE_MAP_KEY` (0xfffff000) business logic.
 *
 * v15 Neuz sends one MAP_KEY per `.wld` file as it loads the world right after
 * the `WORLD_READINFO` sub-snapshot (`Neuz/worldmng.cpp:738`, build at
 * `Neuz/DPClient.cpp:18620` `SendMapKey`). The C++ world compares the client's
 * key against its loaded map manifest in `CWorldMng::CheckMapKey`
 * (`_Common/worldmng.cpp:770`) — mismatch disconnects the client, match/unknown
 * is a silent no-op.
 *
 * This emulator has no server-side map manifest yet, so every well-formed key
 * is accepted. When a manifest lands, swap the `accept` branch for a lookup +
 * `{ ok:false, reason:'mismatch' }` on divergence — the handler already
 * destroys on that outcome, matching C++ `g_DPSrvr.QueryDestroyPlayer`.
 *
 * The service never touches a socket's bytes (rule 02); it returns a verdict
 * and the handler decides whether to destroy.
 *
 * @module services/mapKey.service
 */

import type { PlayerManager } from '../managers/player.manager.js';

export interface MapKeyServiceDeps {
  playerManager: PlayerManager;
}

export type MapKeyOutcome =
  | { ok: true }
  | { ok: false; reason: 'not_in_world' | 'mismatch' };

export class MapKeyService {
  constructor(private deps: MapKeyServiceDeps) {}

  /**
   * Verify a client-sent map key. Accepts all keys until a map manifest exists
   * (see module doc). `charId` comes from the session, not the packet — the
   * client carries no identity in MAP_KEY.
   */
  check(charId: number, _fileName: string, _mapKey: string): MapKeyOutcome {
    const player = this.deps.playerManager.get(charId);
    if (!player) return { ok: false, reason: 'not_in_world' };

    // ponytail: no map manifest yet — accept every key. Upgrade to
    // manifest[fileName] === mapKey (mismatch → { ok:false, reason:'mismatch' })
    // when resource loading exposes the server-side key table.
    return { ok: true };
  }
}

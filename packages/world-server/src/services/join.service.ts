/**
 * JoinService — enter-world business logic.
 *
 * Validates the cluster→world handoff, loads the character from the DB, and
 * places a live `CPlayer` into the player + zone managers. Mirrors the C++
 * `CDPSrvr::OnAddUser` trust chain (`WORLDSERVER/DPSrvr.cpp:612`): the C++
 * world re-verifies `dwAuthKey` against the DB reply at `DPDatabaseClient.cpp
 * :684`. Our analog is the single-use handoff token — consumed here exactly
 * once, and the claimed `idPlayer` + `name` must match both the handoff and
 * the DB row (rule 03 — never trust the client).
 *
 * This service never touches a socket's bytes (rule 02); it returns the
 * spawned `CPlayer` so the handler can build the JOIN/SNAPSHOT frame.
 *
 * @module services/join.service
 */

import type { CharacterRepository, AccountRepository, InventoryRepository } from '@flyff/database';
import { createLogger } from '@flyff/core/logger.js';
import { CPlayer } from '../entities/player.js';
import type { PlayerSocket } from '../entities/player.js';
import { AUTH } from '../constants/authority.js';
import { withinLevelExp } from '../combat/formulas.js';
import type { PlayerManager } from '../managers/player.manager.js';
import type { ZoneManager } from '../managers/zone.manager.js';
import type { ConsumedHandoff } from '../ipc/clusterListener.js';

const logger = createLogger({ module: 'join-service' });

/** Port the join service reads handoffs from — `ClusterListener` satisfies it. */
export interface HandoffSource {
  consumeByCharId(charId: number): ConsumedHandoff | null;
}

export interface JoinServiceDeps {
  charRepo: Pick<CharacterRepository, 'findById'>;
  /** Account lookup for the GM flag → `m_bAuthority`. Optional: defaults to GENERAL. */
  accountRepo?: Pick<AccountRepository, 'findById'>;
  /** Quest state hydration on JOIN. Optional: skips quest load if absent. */
  questService?: { loadOnJoin(player: CPlayer): Promise<void> };
  /** Inventory hydration on JOIN. Optional: empty bag if absent. */
  inventoryRepo?: Pick<InventoryRepository, 'findByCharacterId'>;
  playerManager: PlayerManager;
  zoneManager: ZoneManager;
  handoffSource: HandoffSource;
}

export type JoinOutcome =
  | { ok: true; player: CPlayer }
  | { ok: false; reason: 'bad_token' | 'not_found' | 'world_mismatch' };

export class JoinService {
  constructor(private deps: JoinServiceDeps) {}

  /**
   * Validate the handoff + character, then spawn.
   *
   * Order (rule 03 — validate before any state change):
   *   1. consume the handoff for idPlayer — single-use, binds {charId, worldId}
   *   2. load the character row; must exist (authoritative name/stats come from DB)
   *   3. row's world must match the handoff's world
   *   4. build + register the player
   *
   * The client carries no token and no char name (C++ JOIN carries only
   * `account` + `idPlayer`); the signed IPC publish is the auth, so we look up
   * the pending handoff by `idPlayer` and trust the DB row for everything else.
   */
  async join(socket: PlayerSocket, idPlayer: number): Promise<JoinOutcome> {
    const handoff = this.deps.handoffSource.consumeByCharId(idPlayer);
    if (!handoff) return { ok: false, reason: 'bad_token' };

    const row = await this.deps.charRepo.findById(idPlayer);
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.world_id !== handoff.worldId) return { ok: false, reason: 'world_mismatch' };

    // Resolve GM rank from the account row. C++ populates `m_dwAuthorization`
    // from `prj.CheckStaff(name)` (DPDatabaseClient.cpp:490); we collapse the
    // boolean `gm` flag to GENERAL vs ADMINISTRATOR until a tiered column ships.
    let authority: number = AUTH.GENERAL;
    if (this.deps.accountRepo) {
      const account = await this.deps.accountRepo.findById(row.account_id);
      if (account?.gm) authority = AUTH.ADMINISTRATOR;
    }

    const player = CPlayer.fromRow(row, socket, authority);
    // DB stores cumulative exp (C++ m_nExp1); live field is within-level.
    player.m_nExp = withinLevelExp(Number(row.exp), player.m_nLevel);
    logger.info(
      { charId: player.m_idPlayer, account: row.account_id, gm: authority > AUTH.GENERAL, authority },
      'JOIN resolved authority',
    );
    if (this.deps.questService) await this.deps.questService.loadOnJoin(player);
    await this.loadInventory(player);
    this.deps.playerManager.add(player);
    this.deps.zoneManager.place(player);
    return { ok: true, player };
  }

  /**
   * Hydrate `m_Inventory` from the DB (rule 02 — service maps DB rows to entity
   * state; the entity stays free of repo types). Slots outside the array bounds
   * are dropped defensively. No repo = leave the bag empty (fresh character).
   */
  private async loadInventory(player: CPlayer): Promise<void> {
    if (!this.deps.inventoryRepo) return;
    const rows = await this.deps.inventoryRepo.findByCharacterId(player.m_idPlayer);
    for (const r of rows) {
      if (r.slot < 0 || r.slot >= player.m_Inventory.length) continue;
      player.m_Inventory[r.slot] = { itemId: r.item_id, count: r.quantity };
    }
  }

  /** Disconnect cleanup — drop from both managers (rule 05 — explicit removal). */
  leave(player: CPlayer): void {
    this.deps.zoneManager.remove(player);
    this.deps.playerManager.remove(player.m_idPlayer);
  }
}

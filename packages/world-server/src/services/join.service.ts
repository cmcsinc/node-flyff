/**
 * JoinService -- enter-world business logic.
 *
 * Validates the cluster->world handoff, loads the character from the DB, and
 * places a live `CPlayer` into the player + zone managers. Mirrors the C++
 * `CDPSrvr::OnAddUser` trust chain (`WORLDSERVER/DPSrvr.cpp:612`): the C++
 * world re-verifies `dwAuthKey` against the DB reply at `DPDatabaseClient.cpp
 * :684`. Our analog is the single-use handoff token -- consumed here exactly
 * once, and the claimed `idPlayer` + `name` must match both the handoff and
 * the DB row (rule 03 -- never trust the client).
 *
 * This service never touches a socket's bytes (rule 02); it returns the
 * spawned `CPlayer` so the handler can build the JOIN/SNAPSHOT frame.
 *
 * @module services/join.service
 */

import type { CharacterRepository, AccountRepository, InventoryRepository, BankRepository, SkillRepository } from '@flyff/database';
import { createLogger } from '@flyff/core/logger';
import { CPlayer } from '../entities/player';
import type { PlayerSocket } from '../entities/player';
import { AUTH } from '../constants/authority';
import { withinLevelExp } from '../combat/formulas';
import { decodeTaskBar } from './taskbar.service';
import type { PlayerManager } from '../managers/player.manager';
import type { ZoneManager } from '../managers/zone.manager';
import type { ConsumedHandoff } from '../ipc/clusterListener';

const logger = createLogger({ module: 'join-service' });

/** Port the join service reads handoffs from -- `ClusterListener` satisfies it. */
export interface HandoffSource {
  consumeByCharId(charId: number): ConsumedHandoff | null;
}

export interface JoinServiceDeps {
  /** `findById` for JOIN hydration; `update` for the disconnect checkpoint flush. */
  charRepo: Pick<CharacterRepository, 'findById' | 'update'>;
  /** Account lookup for the GM flag -> `m_bAuthority`. Optional: defaults to GENERAL. */
  accountRepo?: Pick<AccountRepository, 'findById'>;
  /** Quest state hydration on JOIN. Optional: skips quest load if absent. */
  questService?: { loadOnJoin(player: CPlayer): Promise<void> };
  /** Inventory + carried-gold hydration on JOIN. Optional: empty bag / 0 gold if absent. */
  inventoryRepo?: Pick<InventoryRepository, 'findByCharacterId' | 'getGold'>;
  /** Bank hydration on JOIN + gold flush on disconnect. Optional: empty bank if absent. */
  bankRepo?: Pick<BankRepository, 'findByAccountId' | 'getGold' | 'setGold' | 'getBankPass'>;
  /** Skill hydration on JOIN. Optional: empty skill roster if absent. */
  skillRepo?: Pick<SkillRepository, 'loadByCharacter'>;
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
   * Order (rule 03 -- validate before any state change):
   *   1. consume the handoff for idPlayer -- single-use, binds {charId, worldId}
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
    await this.loadBank(player);
    await this.loadSkills(player);
    this.loadTaskBar(player, row.taskbar);
    this.deps.playerManager.add(player);
    this.deps.zoneManager.place(player);
    return { ok: true, player };
  }

  /**
   * Hydrate `m_Inventory` from the DB (rule 02 -- service maps DB rows to entity
   * state; the entity stays free of repo types). Slots outside the array bounds
   * are dropped defensively. No repo = leave the bag empty (fresh character).
   * Restores the full slot (flags/refine/durability), matching {@link loadBank}
   * -- dropping them would silently strip refine/element on relog.
   */
  private async loadInventory(player: CPlayer): Promise<void> {
    if (!this.deps.inventoryRepo) return;
    const rows = await this.deps.inventoryRepo.findByCharacterId(player.m_idPlayer);
    for (const r of rows) {
      if (r.slot < 0 || r.slot >= player.m_Inventory.length) continue;
      player.m_Inventory[r.slot] = {
        objid: r.slot,
        itemId: r.item_id, count: r.quantity,
        flags: r.flags, refine: r.refine, durability: r.durability,
      };
    }
    // Carried penya lives on the inventory container row (migration 008), not
    // the character row -- hydrate it after the slots.
    player.m_nGold = await this.deps.inventoryRepo.getGold(player.m_idPlayer);
  }

  /**
   * Hydrate `m_Bank` (3 tabs) + `m_BankGold` + `m_szBankPass` from the DB. Bank
   * is account-shared (Flyff lore) -- all characters on the account see the
   * same tabs, gold, and pin. Gold + pin live on the `bank` container row
   * (migration 008); gold maps to tab 0 of `m_BankGold`, tabs 1/2 stay 0 until
   * per-tab gold separation is needed.
   */
  private async loadBank(player: CPlayer): Promise<void> {
    if (!this.deps.bankRepo) return;
    const rows = await this.deps.bankRepo.findByAccountId(player.m_accountId);
    for (const r of rows) {
      if (r.tab < 0 || r.tab >= player.m_Bank.length) continue;
      const tab = player.m_Bank[r.tab]!;
      if (r.slot < 0 || r.slot >= tab.length) continue;
      tab[r.slot] = { itemId: r.item_id, count: r.quantity, flags: r.flags, refine: r.refine, durability: r.durability };
    }
    player.m_BankGold[0] = await this.deps.bankRepo.getGold(player.m_accountId);
    // Account-wide bank pin lives on the bank container row (migration 008).
    player.m_szBankPass = await this.deps.bankRepo.getBankPass(player.m_accountId);
  }

  /** Disconnect cleanup -- drop from both managers (rule 05 -- explicit removal). */
  leave(player: CPlayer): void {
    this.deps.zoneManager.remove(player);
    this.deps.playerManager.remove(player.m_idPlayer);
  }

  /**
   * Disconnect flush -- persist the live fields NOT already write-through, then
   * {@link leave}. Mirrors C++ `CDPSrvr::OnRemoveUser` (DPSrvr.cpp:123) +
   * `CPlayer::ExitPlayer`'s save-on-exit.
   *
   * Most mutable state is already persisted at mutation time (fire-and-forget)
   * and WAL-backed: gold (`CHAR_GOLD`), exp/level (`CHAR_EXP`), skill points,
   * inventory slots (`INVENTORY_SLOT`), bank items, bank password, learned
   * skills, quest state. So the checkpoint only flushes the continuously-
   * changing fields with NO per-change DB write -- position + facing angle
   * (movement), vitals (combat HP/MP), and base stats (rule 04 lists position
   * as checkpoint-saved, not journaled).
   *
   * Safe by construction: the caller (dispatcher close hook) cannot await, so
   * every throw is caught here -- the player is removed from managers even if
   * the DB write fails, so a bad row never leaks a ghost into the live set.
   */
  async disconnectByCharId(charId: number | undefined): Promise<void> {
    if (charId === undefined) return;
    const player = this.deps.playerManager.get(charId);
    if (!player) return; // LEAVE before JOIN resolved -- nothing live to save.
    try {
      await this.flushPlayer(player);
      logger.info(
        { charId, pos: player.m_vPos, angle: player.m_fAngle, hp: player.m_nHp, mp: player.m_nMp },
        'Player state saved on disconnect',
      );
    } catch (err) {
      logger.error({ err, charId }, 'Failed to save player state on disconnect');
    }
    this.leave(player);
  }

  /**
   * Checkpoint flush -- persist the live checkpoint fields for one player
   * (position, angle, vitals, stats, bank gold). Used by both
   * {@link disconnectByCharId} (graceful logout) and the 30 s
   * {@link CheckpointSystem} loop (crash recovery -- a hard kill loses at most
   * one checkpoint interval of position/HP progress). Throws upward on DB
   * failure so callers decide policy (disconnect swallows; the loop logs).
   *
   * Fields flushed are absolute end-state, not deltas -- re-flushing an
   * unchanged player is a redundant overwrite, never a dupe or rollback.
   * Bank gold is account-wide; it is always re-written alongside the character
   * row so concurrent characters on the same account converge to the last
   * flush (matches C++ account-shared bank semantics).
   */
  private async flushPlayer(player: CPlayer): Promise<void> {
    await this.deps.charRepo.update(player.m_idPlayer, {
      x: player.m_vPos.x,
      y: player.m_vPos.y,
      z: player.m_vPos.z,
      angle: player.m_fAngle,
      world_id: player.m_worldId,
      zone_id: player.m_nZoneId,
      hp: player.m_nHp,
      mp: player.m_nMp,
      max_hp: player.m_nMaxHp,
      max_mp: player.m_nMaxMp,
      strength: player.m_nStr,
      stamina: player.m_nSta,
      dexterity: player.m_nDex,
      intelligence: player.m_nInt,
    });
    if (this.deps.bankRepo) {
      await this.deps.bankRepo.setGold(player.m_accountId, player.m_BankGold[0]);
    }
  }

  /**
   * Flush every live player's checkpoint state. Called by the 30 s
   * {@link CheckpointSystem} loop. Fire-and-forget per player (rule 05 -- no
   * `await` inside the interval): each flush catches its own rejection so one
   * bad row never aborts the pass. Emulator scale (small live set) makes an
   * unconditional flush cheaper than threading dirty flags through every HP/
   * position mutation site; ponytail: dirty-gate on `_dirty` if scale demands.
   */
  flushAll(): void {
    for (const p of this.deps.playerManager.all()) {
      void this.flushPlayer(p).catch((err) =>
        logger.error({ err, charId: p.m_idPlayer }, 'Checkpoint flush failed'),
      );
    }
  }

  /**
   * Hydrate `m_aJobSkill` from the DB. Learned slots overwrite the NULL_ID
   * defaults; out-of-range slots drop defensively. No repo = leave the roster
   * empty (CPlayer seeds all NULL_ID).
   */
  private async loadSkills(player: CPlayer): Promise<void> {
    if (!this.deps.skillRepo) return;
    const slots = await this.deps.skillRepo.loadByCharacter(player.m_idPlayer);
    player.hydrateSkills(slots);
  }

  /**
   * Hydrate the taskbar grid (`m_aSlotItem`) from `characters.taskbar`. A null
   * / empty column leaves the seeded all-empty grid (fresh character). Mirrors
   * C++ `GetTaskBar` (`DbManagerFun.cpp:984`); the grid is later pushed to the
   * client via `SNAPSHOTTYPE_TASKBAR` in the join handler.
   */
  private loadTaskBar(player: CPlayer, json: string | null | undefined): void {
    player.m_aSlotItem = decodeTaskBar(json);
  }
}

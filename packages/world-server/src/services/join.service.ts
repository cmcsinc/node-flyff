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
import type { ItemDefinition, SetItemDef, SkillIndex } from '@flyff/resources';
import { createLogger } from '@flyff/core/logger';
import { CPlayer } from '@flyff/entities';
import type { PlayerSocket } from '@flyff/entities';
import { AUTH, isJobMatch } from '@flyff/entities';
import { recomputeSetBonuses } from '@flyff/inventory';
import { MAX_HUMAN_PARTS, MAX_INVENTORY, buildSetDestParam } from '@flyff/world-core';
import { decodeTaskBar, decodeTaskBarQueue } from './taskbar.service';
import type { PlayerManager } from '@flyff/world-core';
import type { ZoneManager } from '@flyff/world-core';
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
  /**
   * Skill index for seeding the job-skill roster IDs on JOIN. C++ re-derives
   * `m_aJobSkill[i].dwSkill` from `prj.m_aJobSkill[job]` each load; only levels
   * persist. Without it the client skill tree is empty. Optional: no seed if absent.
   */
  skills?: SkillIndex;
  /**
   * Item-definition lookup for `SetEquipDstParam` on JOIN -- applies each
   * equipped item's DST effects (+STR/+STA/+DEF/etc) to `m_params` so the
   * first swing + regen see buffed stats. Optional: skip if absent (no equip
   * bonuses until first equip/unequip cycle).
   */
  getItem?: (itemId: number) => ItemDefinition | undefined;
  /**
   * Set-item definition lookup (propItemEtc.inc) for seeding set bonuses on
   * JOIN. Optional: skip if absent (no set bonuses until first equip/unequip).
   */
  getSetItem?: (itemId: number) => SetItemDef | undefined;
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
    // DB stores the within-level value directly (C++ m_nExp1 is within-level).
    player.m_nExp = Number(row.exp);
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
        element: r.element, element_level: r.element_level,
      };
    }
    // Carried penya lives on the inventory container row (migration 008), not
    // the character row -- hydrate it after the slots.
    player.m_nGold = await this.deps.inventoryRepo.getGold(player.m_idPlayer);
    // Sync m_invIndex's equip range to the hydrated equip slots (bag range is
    // already identity from the constructor). The JOIN container blob writes
    // m_apIndex[equip] = slot-if-equipped, so the server must match the client
    // or an immediate unequip->sell->buy would desync (see addItem objid note).
    player.syncInvIndexAfterLoad();
    // Apply equipped items' DST effects (C++ `SetEquipDstParam`, MoverParam.cpp:
    // 1903) so buffed STR/STA/DEF/HP_MAX/etc count from the first tick. Must
    // precede the max recompute so JOIN snapshot + regen start from buffed maxes.
    this.applyEquipDstParams(player);
    player.m_nMaxHp = player.getMaxHp();
    player.m_nMaxMp = player.getMaxMp();
    player.m_nMaxFp = player.getMaxFp();
  }

  /**
   * Iterate equipped slots (MAX_INVENTORY..MAX_HUMAN_PARTS-1) and apply each
   * item's `effects` to `m_params`. Idempotent at JOIN (m_params starts empty);
   * subsequent equip/unequip go through `EquipService`. Also seeds the client:
   * the v19 Neuz client does NOT apply equip DST locally (`SetDestParamEquip` is
   * `#ifndef __CLIENT`), so the server must push every active effect at login or
   * the stat window shows base stats only (memory: v19-stat-dst-param-model-shipped).
   */
  private applyEquipDstParams(player: CPlayer): void {
    if (!this.deps.getItem) return;
    const seeded: Array<{ dst: number; adj: number; chg?: number }> = [];
    for (let part = 0; part < MAX_HUMAN_PARTS; part++) {
      const slot = player.m_Inventory[MAX_INVENTORY + part];
      if (!slot) continue;
      const prop = this.deps.getItem(slot.itemId);
      const effects = prop?.effects;
      if (effects && effects.length > 0) {
        player.m_params.applyEffects(effects);
        seeded.push(...effects);
      }
    }
    // Seed set-item bonuses so the JOIN snapshot + regen start from buffed maxes
    // (C++ RedoEquip runs SetDestParamSetItem at load). Mirrors EquipService.
    if (this.deps.getSetItem) recomputeSetBonuses(player, this.deps.getSetItem);

    // Push the full active DST state to self so the client stat window matches
    // the buffed server values from login (per-effect SetDestParam, self-only --
    // peers have not seen this player yet).
    for (const e of seeded) {
      this.deps.playerManager.sendTo(player, buildSetDestParam(player.m_idPlayer, e.dst, e.adj, e.chg));
    }
    for (const e of player.m_setEffects) {
      this.deps.playerManager.sendTo(player, buildSetDestParam(player.m_idPlayer, e.dst, e.adj, e.chg));
    }
  }

  /**
   * Hydrate `m_Bank` (3 tabs) + `m_BankGold` (3 pools) + `m_szBankPass` from the
   * DB. Bank is account-shared (Flyff lore) -- all characters on the account
   * see the same tabs, gold pools, and pin. Gold + pin live on the `bank`
   * container row (migration 008); per-tab gold columns are migration 011.
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
    for (let t = 0; t < player.m_BankGold.length; t++) {
      player.m_BankGold[t] = await this.deps.bankRepo.getGold(player.m_accountId, t);
    }
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
      for (let t = 0; t < player.m_BankGold.length; t++) {
        await this.deps.bankRepo.setGold(player.m_accountId, player.m_BankGold[t]!, t);
      }
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
   * Seed the job-skill roster IDs, then overlay persisted levels. C++ re-derives
   * skill IDs from the job table every load and persists only levels; matching
   * that keeps the client skill tree populated (empty roster = nothing to learn
   * or upgrade). Falls back to the legacy slot-based hydrate when no skill index
   * is wired (tests). No repo = seeded roster at level 0.
   */
  private async loadSkills(player: CPlayer): Promise<void> {
    if (this.deps.skills) {
      player.seedRoster(rosterIdsForJob(this.deps.skills, player.m_nJob));
      if (this.deps.skillRepo) {
        const learned = await this.deps.skillRepo.loadByCharacter(player.m_idPlayer);
        player.overlaySkillLevels(learned);
      }
      return;
    }
    if (!this.deps.skillRepo) return;
    const slots = await this.deps.skillRepo.loadByCharacter(player.m_idPlayer);
    player.hydrateSkills(slots);
  }

  /**
   * Hydrate the taskbar grid (`m_aSlotItem`) + action-slot queue
   * (`m_aSlotQueue`) from `characters.taskbar`. A null/empty column leaves the
   * seeded all-empty grid + queue (fresh character). Mirrors C++
   * `GetTaskBar` (`DbManagerFun.cpp:984`); both are later pushed to the
   * client via `SNAPSHOTTYPE_TASKBAR` in the join handler. Legacy v1 rows
   * (queue absent) hydrate an empty queue.
   */
  private loadTaskBar(player: CPlayer, json: string | null | undefined): void {
    player.m_aSlotItem = decodeTaskBar(json);
    player.m_aSlotQueue = decodeTaskBarQueue(json);
  }
}

/**
 * Ordered skill-id roster for a job -- the set the client skill tree displays.
 * Mirrors C++ `CProject::LoadSkill`: every non-COMMON skill whose JOB_*
 * (`skill.job`) is in the player's job lineage, sorted by `reqLevel` (C++
 * `SortJobSkill` on `dwReqDisLV`) then id for a stable order. A base Vagrant
 * gets its 3 base skills; an advanced job also gets its inherited expert/pro
 * skills (`isJobMatch` walks the lineage). COMMON (tier 4) skills are excluded,
 * exactly as C++ skips `JTYPE_COMMON` from `m_aJobSkill`.
 */
const JTYPE_COMMON = 4;
function rosterIdsForJob(skills: SkillIndex, job: number): number[] {
  const roster = [];
  for (const skill of skills.skills.values()) {
    if (skill.tier === JTYPE_COMMON) continue;
    if (!isJobMatch(job, skill.job)) continue;
    roster.push(skill);
  }
  roster.sort((a, b) => (a.reqLevel - b.reqLevel) || (a.id - b.id));
  return roster.map((s) => s.id);
}

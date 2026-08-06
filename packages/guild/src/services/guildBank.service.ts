/**
 * GuildBankService -- the 42-slot shared guild warehouse.
 *
 * Port of `CDPSrvr::OnOpenGuildBankWnd` / `OnCloseGuildBankWnd` /
 * `OnPutItemGuildBank` / `OnGetItemGuildBank` / `OnGuildBankMoveItem`
 * (`WORLDSERVER/DPSrvr.cpp:3271, 3370, 3574, 3666, 3786`), backed by
 * `guild_bank` / `guild_bank_item` (migration `024`).
 *
 * Four things about this subsystem are load-bearing and easy to get wrong:
 *
 * 1. **Penya is one-way.** Deposit REJECTS `mode == 0` outright
 *    (`DPSrvr.cpp:3592`) -- penya only ever leaves the bank. It gets in through
 *    contribution (`NW_GUILDCONTRIBUTION`), which is why the balance lives on
 *    `CGuild::m_nGoldGuild` and not on a bank table: the same field is the
 *    level-up currency (`AddContribution` spends it), so a separate bank balance
 *    would desync levelling from withdrawals.
 * 2. **Every opcode re-checks NPC proximity**, not just the window open
 *    (`IsCloseNpc( MMI_GUILDBANKING, ... )` at `:3590` and `:3682`). A client
 *    that opens the window and walks away must not keep transacting.
 * 3. **Withdrawal is authority-gated per kind**: penya needs `PF_PENYA`
 *    (`CGuild::IsGetPenya`), items need `PF_ITEM` (`IsGetItem`). Deposit needs
 *    neither -- anyone in the guild may give.
 * 4. **A penya withdrawal debits the withdrawer's contribution record**
 *    (`pGuild->DecrementMemberContribution( ..., nGold, 0 )`, `:3700`), so taking
 *    money back reduces your recorded donation rather than leaving you credited
 *    for penya you removed.
 *
 * The item echoes multiplex several bodies onto one snapshot subtype via a
 * leading recipient byte -- see the `GUILD_BANK_ECHO_*` constants.
 *
 * ponytail: the bank LOG (`LOG_GUILD_STR`, `DbManager.cpp:4224`) -- the repo
 * records `deposited_by` so the log can be reconstructed, but the
 * `GUILDLOG_VIEW` opcode and its viewer are not ported. Guild-house banks
 * (`__GUILD_HOUSE`, which bypass the NPC proximity check) are out of scope: the
 * feature is compiled out in v19.
 *
 * @module services/guildBank
 */

import type { CPlayer, InventorySlot } from '@flyff/entities';
import type { PlayerManager, SpawnManager } from '@flyff/world-core';
import {
  buildGuildBankWindow, buildPutItemGuildBank, buildGetItemGuildBank,
  buildGetGoldGuildBank, buildRemoveGuildBankItem,
  MAX_GUILDBANK, MAX_LEN_MOVER_MENU_SQ,
  GUILD_BANK_ECHO_SELF, GUILD_BANK_ECHO_PEER,
  GUILD_BANK_ECHO_PENYA_SELF, GUILD_BANK_ECHO_PENYA_PEER,
  PF_PENYA, PF_ITEM,
} from '@flyff/world-core';
import { MMI_GUILDBANKING } from '@flyff/resources';
import { createLogger } from '@flyff/core/logger';
import type { GuildManager } from '../managers/guild.manager';

const logger = createLogger({ module: 'guild-bank' });

/** Withdraw modes -- the `mode` byte of GETITEMGUILDBANK (`DPSrvr.cpp:3685`). */
export const WITHDRAW_MODE_PENYA = 0;
export const WITHDRAW_MODE_ITEM = 1;

/**
 * One live bank slot. Narrows `InventorySlot`'s optional item-instance fields to
 * REQUIRED, because a bank row always has a concrete value for each (the repo
 * columns are `notNullable` with defaults). Without the narrowing, passing a
 * slot straight to the repo trips `exactOptionalPropertyTypes` -- and more to the
 * point, an item whose refine/element silently became `undefined` on deposit
 * would come back out of the bank stripped of its enchant.
 */
export interface GuildBankSlot extends InventorySlot {
  /** `CItemElem::m_dwObjId` -- the stable handle the client addresses. */
  objid: number;
  refine: number;
  element: number;
  element_level: number;
  flags: number;
  /** `m_nHitPoint`; -1 = indestructible. */
  durability: number;
}

/**
 * Persistence port -- structurally satisfied by `GuildBankRepository`.
 * An interface so the service stays testable with a plain object.
 */
export interface GuildBankPersistence {
  loadAll(): Promise<Map<number, {
    slot: number; itemId: number; count: number; objid: number | null;
    refine: number; element: number; elementLevel: number; flags: number;
    durability: number; stats: string | null;
    depositedBy: number | null; depositedAtMs: number;
  }[]>>;
  setSlot(guildId: number, slot: number, item: {
    itemId: number; count?: number; objid?: number | null; refine?: number;
    element?: number; elementLevel?: number; flags?: number;
    durability?: number; stats?: string | null; depositedBy?: number | null;
  }): Promise<void>;
  clearSlot(guildId: number, slot: number): Promise<void>;
  moveSlot(guildId: number, src: number, dst: number): Promise<void>;
}

/**
 * Inventory surface -- structurally satisfied by `InventoryService`. Kept a port
 * so `@flyff/guild` never imports `@flyff/inventory` (same rule as the
 * contribution service).
 */
export interface GuildBankInventoryPort {
  /** Read a main-bag slot. Null when empty or out of range. */
  getSlot(player: CPlayer, slot: number): InventorySlot | null;
  /** `pUser->RemoveItem( nId, nItemNum )`. False = refused. */
  removeItem(player: CPlayer, slot: number, count: number): boolean;
  /** `m_Inventory.Add` -- returns the destination slot, or -1 when the bag is full. */
  addItem(player: CPlayer, item: InventorySlot): number;
  /** `pUser->AddGold( nGold )` with the MAX_GOLD clamp. */
  addGold(player: CPlayer, amount: number): void;
  /** `CanAdd( GetGold(), nGold )` -- would this credit overflow the cap? */
  canAddGold(player: CPlayer, amount: number): boolean;
  /** True when the item may not be deposited (quest/bound/charged/in-use/equipped). */
  isDepositBlocked(player: CPlayer, slot: number): boolean;
}

export interface GuildBankServiceDeps {
  playerManager: PlayerManager;
  guildManager: GuildManager;
  spawnManager: SpawnManager;
  inventory: GuildBankInventoryPort;
  repo?: GuildBankPersistence;
  /** `g_eLocal.GetState( ENABLE_GUILD_INVENTORY )`. Defaults on. */
  guildInventoryEnabled?: () => boolean;
}

export class GuildBankService {
  /** guildId -> the 42-slot container. Sparse; index === slot. */
  private readonly banks = new Map<number, (GuildBankSlot | null)[]>();
  /** Characters with the window currently open -- `CUser::m_bGuildBank`. */
  private readonly open = new Set<number>();
  private readonly enabled: () => boolean;

  constructor(private readonly deps: GuildBankServiceDeps) {
    this.enabled = deps.guildInventoryEnabled ?? ((): boolean => true);
  }

  /** World-boot hydrate -- one query, grouped by guild. */
  async hydrate(): Promise<void> {
    if (!this.deps.repo) return;
    const all = await this.deps.repo.loadAll();
    for (const [guildId, items] of all) {
      const bank = emptyBank();
      for (const it of items) {
        if (it.slot < 0 || it.slot >= MAX_GUILDBANK) continue;
        bank[it.slot] = {
          itemId: it.itemId, count: it.count,
          objid: it.objid ?? it.slot,
          refine: it.refine, element: it.element, element_level: it.elementLevel,
          flags: it.flags, durability: it.durability,
        };
      }
      this.banks.set(guildId, bank);
    }
    logger.info({ guilds: this.banks.size }, 'guild banks loaded');
  }

  /**
   * `PACKETTYPE_GUILD_BANK_WND` -- open the window (`DPSrvr.cpp:3271`).
   *
   * C++ refuses while trading, running a personal vendor, or with the PERSONAL
   * bank open (`m_bBank`). Those three are passed in as `busy` because they live
   * on other services; the proximity + guild checks are here.
   */
  open_(player: CPlayer, busy = false): void {
    if (!this.enabled() || busy) return;
    const guild = this.deps.guildManager.getByMember(player.m_idPlayer);
    if (!guild) return;
    if (!this.nearBankNpc(player)) return;
    this.open.add(player.m_idPlayer);
    this.deps.playerManager.sendTo(player, buildGuildBankWindow(
      player.m_idPlayer, 0, guild.gold, this.bank(guild.id),
    ));
  }

  /** `PACKETTYPE_GUILD_BANK_WND_CLOSE` -- clears `m_bGuildBank` (`:3370`). */
  close(player: CPlayer): void {
    this.open.delete(player.m_idPlayer);
  }

  /** Disconnect hook -- a dropped socket must not leave the flag set. */
  onDisconnect(characterId: number): void {
    this.open.delete(characterId);
  }

  /**
   * `PACKETTYPE_PUTITEMGUILDBANK` -- deposit (`DPSrvr.cpp:3574`).
   *
   * `mode == 0` (gold) is rejected: penya cannot be deposited here at all.
   * No authority bit is required -- any member may give. `count` is clamped to
   * the stack size and floored at 1, exactly as C++ does before the transfer.
   */
  putItem(player: CPlayer, invSlot: number, count: number, mode: number): void {
    if (!this.enabled()) return;
    if (mode === 0) return; // penya deposit is not a thing (:3592)
    if (!this.nearBankNpc(player)) return;
    const guild = this.deps.guildManager.getByMember(player.m_idPlayer);
    if (!guild) return;
    const src = this.deps.inventory.getSlot(player, invSlot);
    if (!src) return;
    if (this.deps.inventory.isDepositBlocked(player, invSlot)) return;

    // C++ clamps DOWN to the stack then floors at 1 (`:3628`).
    let n = count > src.count ? src.count : count;
    if (n < 1) n = 1;

    const bank = this.bank(guild.id);
    const dst = firstFree(bank);
    if (dst === -1) return; // TID_GAME_GUILDBANKFULL
    if (!this.deps.inventory.removeItem(player, invSlot, n)) return;

    const stored: GuildBankSlot = {
      itemId: src.itemId, count: n, objid: dst,
      refine: src.refine ?? 0, element: src.element ?? 0,
      element_level: src.element_level ?? 0,
      flags: src.flags ?? 0, durability: src.durability ?? -1,
    };
    bank[dst] = stored;
    void this.deps.repo?.setSlot(guild.id, dst, {
      itemId: stored.itemId, count: n, objid: dst,
      refine: stored.refine, element: stored.element,
      elementLevel: stored.element_level, flags: stored.flags,
      durability: stored.durability, depositedBy: player.m_idPlayer,
    }).catch((err: unknown) => logger.error({ err, guildId: guild.id, dst }, 'bank deposit persist failed'));

    this.deps.playerManager.sendTo(player, buildPutItemGuildBank(
      player.m_idPlayer, GUILD_BANK_ECHO_SELF, dst, stored,
    ));
    this.echoToOpenPeers(guild.id, player.m_idPlayer, buildPutItemGuildBank(
      player.m_idPlayer, GUILD_BANK_ECHO_PEER, dst, stored,
    ));
  }

  /**
   * `PACKETTYPE_GETITEMGUILDBANK` -- withdraw (`DPSrvr.cpp:3666`).
   * Dispatches on `mode`: 0 = penya (needs PF_PENYA), 1 = item (needs PF_ITEM).
   */
  getItem(player: CPlayer, bankSlot: number, amount: number, mode: number): void {
    if (!this.enabled()) return;
    if (!this.nearBankNpc(player)) return;
    if (mode === WITHDRAW_MODE_PENYA) this.withdrawPenya(player, amount);
    else this.withdrawItem(player, bankSlot, amount);
  }

  /**
   * Penya withdrawal (`DPSrvr.cpp:3685-3729`). Needs `PF_PENYA`. Rejects a
   * non-positive amount, a credit that would overflow the player's gold cap, and
   * an amount exceeding the pool.
   *
   * Then it debits the withdrawer's own contribution record
   * (`DecrementMemberContribution`), so pulling money out reduces your recorded
   * donation. Peers get the mode-2 echo naming the withdrawer.
   */
  private withdrawPenya(player: CPlayer, gold: number): void {
    if (gold <= 0) return;
    if (!this.deps.inventory.canAddGold(player, gold)) return;
    const guild = this.deps.guildManager.getByMember(player.m_idPlayer);
    if (!guild) return;
    const member = this.deps.guildManager.getMember(guild.id, player.m_idPlayer);
    if (!member) return;
    if (!this.deps.guildManager.rankHasPower(guild.id, member.memberLv, PF_PENYA)) return;
    if (gold > guild.gold) return;

    this.deps.inventory.addGold(player, gold);
    this.deps.guildManager.setGold(guild.id, guild.gold - gold);
    this.deps.guildManager.decrementMemberContribution(guild.id, player.m_idPlayer, 0, gold);

    this.deps.playerManager.sendTo(player, buildGetGoldGuildBank(
      player.m_idPlayer, GUILD_BANK_ECHO_PENYA_SELF, gold, player.m_idPlayer,
    ));
    // Penya peers are EVERY online member (`:3716`), not just those with the
    // window open -- the guild-window balance has to move for all of them.
    const peer = buildGetGoldGuildBank(
      player.m_idPlayer, GUILD_BANK_ECHO_PENYA_PEER, gold, player.m_idPlayer,
    );
    for (const m of guild.members) {
      if (m.characterId === player.m_idPlayer) continue;
      const p = this.deps.playerManager.get(m.characterId);
      if (p) this.deps.playerManager.sendTo(p, peer);
    }
    logger.info({ guildId: guild.id, charId: player.m_idPlayer, gold }, 'guild bank penya withdrawn');
  }

  /**
   * Item withdrawal (`DPSrvr.cpp:3732-3781`). Needs `PF_ITEM`. `amount` is
   * clamped to the stored stack and floored at 1; a partial take leaves the
   * remainder in the slot, a full take frees it.
   *
   * The bag insert happens BEFORE the bank mutation (C++ order) so a full bag
   * cannot destroy the stack.
   */
  private withdrawItem(player: CPlayer, bankSlot: number, amount: number): void {
    const guild = this.deps.guildManager.getByMember(player.m_idPlayer);
    if (!guild) return;
    const member = this.deps.guildManager.getMember(guild.id, player.m_idPlayer);
    if (!member) return;
    if (!this.deps.guildManager.rankHasPower(guild.id, member.memberLv, PF_ITEM)) return;
    if (bankSlot < 0 || bankSlot >= MAX_GUILDBANK) return;

    const bank = this.bank(guild.id);
    const stored = bank[bankSlot];
    if (!stored) return;

    let n = amount > stored.count ? stored.count : amount;
    if (n < 1) n = 1;

    const taken: GuildBankSlot = { ...stored, count: n };
    if (this.deps.inventory.addItem(player, taken) === -1) return; // bag full

    if (stored.count > n) {
      stored.count -= n;
      void this.deps.repo?.setSlot(guild.id, bankSlot, {
        itemId: stored.itemId, count: stored.count, objid: stored.objid,
        refine: stored.refine, element: stored.element,
        elementLevel: stored.element_level, flags: stored.flags,
        durability: stored.durability,
      }).catch((err: unknown) => logger.error({ err, guildId: guild.id }, 'bank partial-take persist failed'));
    } else {
      bank[bankSlot] = null;
      void this.deps.repo?.clearSlot(guild.id, bankSlot)
        .catch((err: unknown) => logger.error({ err, guildId: guild.id }, 'bank clear persist failed'));
    }

    this.deps.playerManager.sendTo(player, buildGetItemGuildBank(
      player.m_idPlayer, GUILD_BANK_ECHO_SELF, stored.objid, taken,
    ));
    this.echoToOpenPeers(guild.id, player.m_idPlayer, buildGetItemGuildBank(
      player.m_idPlayer, GUILD_BANK_ECHO_PEER, stored.objid, taken,
    ));
    if (bank[bankSlot] === null) {
      this.echoToOpenPeers(guild.id, -1, buildRemoveGuildBankItem(
        player.m_idPlayer, guild.id, stored.objid, n,
      ));
    }
  }

  /**
   * `PACKETTYPE_GUILD_BANK_MOVEITEM` -- reorder within the bank
   * (`DPSrvr.cpp:3786`). A plain swap; either end may be empty.
   */
  moveItem(player: CPlayer, src: number, dst: number): void {
    if (!this.enabled()) return;
    if (src === dst) return;
    if (src < 0 || src >= MAX_GUILDBANK || dst < 0 || dst >= MAX_GUILDBANK) return;
    const guild = this.deps.guildManager.getByMember(player.m_idPlayer);
    if (!guild) return;
    const bank = this.bank(guild.id);
    const a = bank[src] ?? null;
    if (!a) return; // nothing to move
    const b = bank[dst] ?? null;
    bank[src] = b;
    bank[dst] = a;
    // `objid` MUST follow the slot. C++ gets this for free: `m_dwObjId` is the
    // index into `m_apItem` and `Swap` only permutes `m_apIndex`, so the id never
    // moves. Our bank is one flat array indexed BY slot, and both the window
    // resend (`writeItemContainer` writes the array index as `m_dwObjId`) and the
    // withdraw echoes address items by it -- so leaving it stale makes the two
    // disagree, and the client's `GetAtId( m_dwObjId )` lookup misses. The
    // symptom is a withdrawal the grid never applies until the window reopens.
    a.objid = dst;
    if (b) b.objid = src;
    void this.deps.repo?.moveSlot(guild.id, src, dst)
      .catch((err: unknown) => logger.error({ err, guildId: guild.id, src, dst }, 'bank move persist failed'));
    // The client applies its own optimistic swap; a full window resend keeps a
    // rejected move from leaving the two views disagreeing.
    this.deps.playerManager.sendTo(player, buildGuildBankWindow(
      player.m_idPlayer, 0, guild.gold, bank,
    ));
  }

  /** Read-only view of a guild's bank -- used by the window builder + tests. */
  bank(guildId: number): (GuildBankSlot | null)[] {
    let b = this.banks.get(guildId);
    if (!b) { b = emptyBank(); this.banks.set(guildId, b); }
    return b;
  }

  /** Is this character's guild-bank window open? (`CUser::m_bGuildBank`) */
  isOpen(characterId: number): boolean { return this.open.has(characterId); }

  /**
   * Item echoes reach only guild members who ALSO have the window open --
   * `USERPTR->m_bGuildBank == TRUE && USERPTR->m_idGuild == pUser->m_idGuild`
   * (`User.cpp:5336`). Pass `-1` as `exceptId` to include everyone.
   */
  private echoToOpenPeers(guildId: number, exceptId: number, packet: Buffer): void {
    const guild = this.deps.guildManager.get(guildId);
    if (!guild) return;
    for (const m of guild.members) {
      if (m.characterId === exceptId) continue;
      if (!this.open.has(m.characterId)) continue;
      const p = this.deps.playerManager.get(m.characterId);
      if (p) this.deps.playerManager.sendTo(p, packet);
    }
  }

  /**
   * `CNpcChecker::IsCloseNpc( MMI_GUILDBANKING, ... )` (`npchecker.cpp:56`).
   * Squared XZ distance against `MAX_LEN_MOVER_MENU`, same as the personal bank.
   */
  private nearBankNpc(player: CPlayer): boolean {
    for (const npc of this.deps.spawnManager.inZone(player.m_nZoneId)) {
      if (!npc.m_abMoverMenu.includes(MMI_GUILDBANKING)) continue;
      const dx = player.m_vPos.x - npc.m_vPos.x;
      const dz = player.m_vPos.z - npc.m_vPos.z;
      if (dx * dx + dz * dz <= MAX_LEN_MOVER_MENU_SQ) return true;
    }
    return false;
  }
}

/** A fresh 42-slot container. */
function emptyBank(): (GuildBankSlot | null)[] {
  return new Array<GuildBankSlot | null>(MAX_GUILDBANK).fill(null);
}

/** First free slot, or -1 when full (`CItemContainer::Add` semantics). */
function firstFree(bank: readonly (GuildBankSlot | null)[]): number {
  for (let i = 0; i < MAX_GUILDBANK; i++) if (!bank[i]) return i;
  return -1;
}

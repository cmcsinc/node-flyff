/**
 * BankService -- bank open + item/gold deposit & withdraw.
 *
 * Ports `CDPSrvr::OnPutItemBank` / `OnGetItemBank` / `OnPutGoldBank` /
 * `OnGetGoldBank` (`WORLDSERVER/DPSrvr.cpp:3430/3791/3848/3900`). Bank is
 * account-shared (3 tabs * BANK_SLOTS). Moves items between the main bag and
 * `m_Bank[tab]`, gold between `m_nGold` and `m_BankGold[tab]` -- v19 carries
 * one gold pool per tab (`m_BankGold[3]`), and PUTGOLDBANK / GETGOLDBANK send
 * `BYTE nSlot` to select it. Each journals + persists before the handler acks
 * (PUTITEMBANK / GETITEMBANK / PUTGOLDBANK).
 *
 * The client drags optimistically; ack snapshots confirm the new bank/gold
 * state. Inventory-side changes the client applies locally (same model as
 * MOVEITEM).
 *
 * ponytail: bank-to-bank gold transfer.
 *
 * @module services/bank
 */

import type { BankRepository, InventoryRepository, Journal } from '@flyff/database';
import { createLogger } from '@flyff/core/logger';
import { MAX_GOLD } from '@flyff/core';
import type { CPlayer, CMover, InventorySlot } from '@flyff/entities';
import { MAX_INVENTORY, BANK_SLOTS, MAX_BANK_TABS, NULL_ID } from '@flyff/world-core';
import { MMI_BANKING } from '@flyff/resources';

const logger = createLogger({ module: 'bank-service' });

/** C++ `MAX_LEN_MOVER_MENU` (npchecker.h:4) -- squared distance gate. */
const MAX_LEN_MOVER_MENU_SQ = 1024;

/** SpawnManager surface consumed for bank NPC proximity checks. */
export interface BankSpawnLookup {
  inZone(zoneId: number): readonly CMover[];
}

export interface BankServiceDeps {
  bankRepo: Pick<BankRepository, 'setItem' | 'removeItem' | 'getGold' | 'setGold' | 'getBankPass' | 'setBankPass'>;
  inventoryRepo: Pick<InventoryRepository, 'removeItem' | 'setItem' | 'setGold'>;
  spawnManager?: BankSpawnLookup;
  journal?: Journal;
}

/** Max bank-password length (C++ `OnChangeBankPass:3965` rejects `strlen > 4`). */
const MAX_BANK_PASS_LEN = 4;
/** Sentinel for "no password set" (C++ `OnOpenBankWnd:3218`). */
const NO_BANK_PASS = '0000';

export interface ChangeBankPassResult { ok: boolean; dwId: number; dwItemId: number }

export type DepositResult =
  | { ok: true; tab: number; bankSlot: number; item: InventorySlot }
  | { ok: false; reason: 'invalid' | 'bank_full' | 'restricted' };

export type WithdrawResult =
  | { ok: true; tab: number; bankSlot: number; item: InventorySlot }
  | { ok: false; reason: 'invalid' | 'bag_full' };

export type GoldMoveResult =
  | { ok: true; tab: number; invGold: number; bankGold: number }
  | { ok: false; reason: 'invalid' };

export class BankService {
  constructor(private readonly deps: BankServiceDeps) {}

  /**
   * Open the bank window for an NPC bank (dwId == NULL_ID). Mirrors
   * `OnOpenBankWnd` (DPSrvr.cpp:3218): returns the `AddBankWindow` nMode that
   * tells the client which dialog to open. Per the client's `OnBankWindow`
   * (DPClient.cpp:2969) `if( nMode )` routes to `CWndConfirmBank` (enter-pin),
   * else `CWndBankPassword` (set/change-pin). So:
   *   `'0000'` (no password) -> nMode 0 -> set-pin dialog
   *   any set password       -> nMode 1 -> enter-pin dialog (then CONFIRMBANK)
   *
   * **H14** (DPSrvr.cpp:3248): when `dwId == NULL_ID` (direct bank open,
   * not via NPC click), must be within `MAX_LEN_MOVER_MENU` of a bank NPC.
   * **H15** (DPSrvr.cpp:3251): chaotic players (PK propensity > 0) cannot
   * open the bank. `prj.GetPropensityPenalty().nBank` is not ported yet --
   * `isChaotic()` is the gate (ponytail: upgrade to propensity-penalty table
   * when PK penalty system ships).
   */
  open(player: CPlayer, dwId: number): number {
    if (dwId === NULL_ID) {
      if (!this.hasNearbyBankNpc(player)) return -1;
    }
    if (player.isChaotic()) return -1;
    player.m_bBankOpen = true;
    return player.m_szBankPass === NO_BANK_PASS ? 0 : 1;
  }

  close(player: CPlayer): void {
    player.m_bBankOpen = false;
  }

  /**
   * CONFIRMBANK password check -- `OnConfirmBank:4017`. Body is
   * `szPass(10), dwId, dwItemId`. Compares against the character's real
   * `m_szBankPass`: on match the bank opens (nMode=1); on mismatch the client
   * re-prompts (nMode=0). A password-less bank (`'0000'`) always matches.
   */
  confirmBankPass(player: CPlayer, szPass: string, dwId: number, dwItemId: number): ChangeBankPassResult {
    const ok = szPass === player.m_szBankPass;
    if (ok) player.m_bBankOpen = true;
    return { ok, dwId, dwItemId };
  }

  /**
   * CHANGEBANKPASS -- `OnChangeBankPass:3955`. Body is
   * `szLastPass(<=4), szNewPass(<=4), dwId, dwItemId`. Rejects (silently, ack
   * nMode=0) if either password exceeds 4 chars or the old one does not match
   * the current `m_szBankPass`. On success the new password is set in memory,
   * journaled, and persisted (mirrors `SendChangeBankPass`).
   */
  changeBankPass(player: CPlayer, szLastPass: string, szNewPass: string, dwId: number, dwItemId: number): ChangeBankPassResult {
    if (szLastPass.length > MAX_BANK_PASS_LEN || szNewPass.length > MAX_BANK_PASS_LEN) {
      return { ok: false, dwId, dwItemId };
    }
    if (szLastPass !== player.m_szBankPass) {
      return { ok: false, dwId, dwItemId };
    }
    const newPass = szNewPass.length === 0 ? NO_BANK_PASS : szNewPass;
    // Account-wide pin (migration 008): journal carries accountId so the WAL
    // replayer addresses the bank container, not a character row.
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'BANK_PASS', payload: { accountId: player.m_accountId, bankPass: newPass } });
    player.m_szBankPass = newPass;
    this.deps.bankRepo.setBankPass(player.m_accountId, newPass).catch((e: unknown) => { logger.warn({ err: e }, 'bank pass persist failed'); });
    return { ok: true, dwId, dwItemId };
  }

  /** Move `count` from inv `invSlot` into the first empty slot of bank `tab`. */
  deposit(player: CPlayer, tab: number, invSlot: number, count: number): DepositResult {
    if (tab < 0 || tab >= MAX_BANK_TABS || !this.inMainBag(invSlot)) return { ok: false, reason: 'invalid' };
    const src = player.m_Inventory[invSlot];
    if (!src || count <= 0) return { ok: false, reason: 'invalid' };
    const tabArr = player.m_Bank[tab];
    if (!tabArr) return { ok: false, reason: 'invalid' };
    const bankSlot = this.findEmptyBank(player, tab);
    if (bankSlot === -1) return { ok: false, reason: 'bank_full' };

    const take = Math.min(count, src.count);
    const moved = this.cloneSlot(src, take);
    // Absolute end-state on BOTH sides (rule 04 / `journalReplayers.ts`
    // idempotency contract): the bank slot gains the moved stack, the inv slot
    // keeps the remainder (or clears). The old `BANK_DEPOSIT` delta row could
    // only be replayed once and guessed at the inventory remainder.
    const invLeft = src.count - take;
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'BANK_SLOT', payload: { accountId: player.m_accountId, tab, slot: bankSlot, itemId: moved.itemId, count: moved.count, flags: moved.flags ?? 0, durability: moved.durability ?? -1, refine: moved.refine ?? 0 } });
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'INVENTORY_SLOT', payload: invLeft > 0 ? { slot: invSlot, itemId: src.itemId, count: invLeft, flags: src.flags ?? 0, durability: src.durability ?? -1, refine: src.refine ?? 0 } : { slot: invSlot, itemId: 0, count: 0 } });

    tabArr[bankSlot] = moved;
    if (take >= src.count) {
      player.m_Inventory[invSlot] = null;
      this.deps.inventoryRepo.removeItem(player.m_idPlayer, invSlot).catch((e: unknown) => { logger.warn({ err: e }, 'bank inv remove failed'); });
    } else {
      src.count -= take;
      this.deps.inventoryRepo.setItem(player.m_idPlayer, invSlot, src.itemId, src.count, src.flags ?? 0, src.durability ?? -1, src.refine ?? 0).catch((e: unknown) => { logger.warn({ err: e }, 'bank inv set failed'); });
    }
    this.deps.bankRepo.setItem(player.m_accountId, tab, bankSlot, moved.itemId, moved.count, moved.flags ?? 0, moved.durability ?? -1, moved.refine ?? 0).catch((e: unknown) => { logger.warn({ err: e }, 'bank set failed'); });
    player._dirty.add('m_Inventory');
    return { ok: true, tab, bankSlot, item: moved };
  }

  /** Move `count` from bank `tab`/`bankSlot` into the first empty inv slot. */
  withdraw(player: CPlayer, tab: number, bankSlot: number, count: number): WithdrawResult {
    if (tab < 0 || tab >= MAX_BANK_TABS || bankSlot < 0 || bankSlot >= BANK_SLOTS) return { ok: false, reason: 'invalid' };
    const tabArr = player.m_Bank[tab];
    if (!tabArr) return { ok: false, reason: 'invalid' };
    const src = tabArr[bankSlot];
    if (!src || count <= 0) return { ok: false, reason: 'invalid' };
    const invSlot = this.findEmptyInv(player);
    if (invSlot === -1) return { ok: false, reason: 'bag_full' };

    const take = Math.min(count, src.count);
    const moved = this.cloneSlot(src, take);
    // Absolute end-state on both sides (see `deposit`).
    const bankLeft = src.count - take;
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'INVENTORY_SLOT', payload: { slot: invSlot, itemId: moved.itemId, count: moved.count, flags: moved.flags ?? 0, durability: moved.durability ?? -1, refine: moved.refine ?? 0 } });
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'BANK_SLOT', payload: bankLeft > 0 ? { accountId: player.m_accountId, tab, slot: bankSlot, itemId: src.itemId, count: bankLeft, flags: src.flags ?? 0, durability: src.durability ?? -1, refine: src.refine ?? 0 } : { accountId: player.m_accountId, tab, slot: bankSlot, itemId: 0, count: 0 } });

    player.m_Inventory[invSlot] = moved;
    if (take >= src.count) {
      tabArr[bankSlot] = null;
      this.deps.bankRepo.removeItem(player.m_accountId, tab, bankSlot).catch((e: unknown) => { logger.warn({ err: e }, 'bank remove failed'); });
    } else {
      src.count -= take;
      this.deps.bankRepo.setItem(player.m_accountId, tab, bankSlot, src.itemId, src.count, src.flags ?? 0, src.durability ?? -1, src.refine ?? 0).catch((e: unknown) => { logger.warn({ err: e }, 'bank set failed'); });
    }
    this.deps.inventoryRepo.setItem(player.m_idPlayer, invSlot, moved.itemId, moved.count, moved.flags ?? 0, moved.durability ?? -1, moved.refine ?? 0).catch((e: unknown) => { logger.warn({ err: e }, 'bank inv set failed'); });
    player._dirty.add('m_Inventory');
    return { ok: true, tab, bankSlot, item: moved };
  }

  /**
   * Move `amount` gold from inv into bank `tab` (v19 per-tab gold pool,
   * `m_BankGold[tab]`). `tab` is the `BYTE nSlot` from PUTGOLDBANK
   * (DPSrvr.cpp:3848); validated in [0, MAX_BANK_TABS).
   *
   * **H16** (DPSrvr.cpp:3918): `OnPutGoldBank` checks `IsCloseNpc(MMI_BANKING)`
   * unless `m_bInstantBank` is set. `m_bInstantBank` is not ported yet
   * (ponytail: add when GM instant-bank feature ships); the proximity check
   * always applies.
   */
  depositGold(player: CPlayer, tab: number, amount: number): GoldMoveResult {
    if (!Number.isInteger(tab) || tab < 0 || tab >= MAX_BANK_TABS) return { ok: false, reason: 'invalid' };
    const bankGold = player.m_BankGold[tab];
    if (bankGold === undefined) return { ok: false, reason: 'invalid' };
    if (amount <= 0 || amount > player.m_nGold) return { ok: false, reason: 'invalid' };
    if (!this.hasNearbyBankNpc(player)) return { ok: false, reason: 'invalid' };
    // M12: C++ DPSrvr.cpp:3929 -- `CanAdd(m_dwGoldBank[nSlot], nGold)` rejects
    // deposits that would overflow the bank tab's gold pool.
    if (bankGold + amount > MAX_GOLD) return { ok: false, reason: 'invalid' };
    player.m_nGold -= amount;
    player.m_BankGold[tab] = bankGold + amount;
    // Canonical CHAR_GOLD carries the absolute post-mutation m_nGold so WAL
    // replay restores the inventory side too -- without this the inventory
    // container keeps the pre-deposit value and a relog dupes the penya back.
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'CHAR_GOLD', payload: { gold: player.m_nGold } });
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'BANK_GOLD', payload: { accountId: player.m_accountId, tab, gold: player.m_BankGold[tab] } });
    this.persistGold(player, tab);
    return { ok: true, tab, invGold: player.m_nGold, bankGold: player.m_BankGold[tab] ?? 0 };
  }

  /** Move `amount` gold from bank `tab` into inv. */
  withdrawGold(player: CPlayer, tab: number, amount: number): GoldMoveResult {
    if (!Number.isInteger(tab) || tab < 0 || tab >= MAX_BANK_TABS) return { ok: false, reason: 'invalid' };
    const bankGold = player.m_BankGold[tab];
    if (bankGold === undefined) return { ok: false, reason: 'invalid' };
    if (amount <= 0 || amount > bankGold) return { ok: false, reason: 'invalid' };
    player.m_BankGold[tab] = bankGold - amount;
    player.m_nGold += amount;
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'CHAR_GOLD', payload: { gold: player.m_nGold } });
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'BANK_GOLD', payload: { accountId: player.m_accountId, tab, gold: player.m_BankGold[tab] } });
    this.persistGold(player, tab);
    return { ok: true, tab, invGold: player.m_nGold, bankGold: player.m_BankGold[tab] ?? 0 };
  }

  private persistGold(player: CPlayer, tab: number): void {
    const bankGold = player.m_BankGold[tab];
    if (bankGold === undefined) return;
    player._dirty.add('m_nGold');
    this.deps.inventoryRepo.setGold(player.m_idPlayer, player.m_nGold)
      .catch((e: unknown) => { logger.warn({ err: e }, 'inv gold persist failed'); });
    this.deps.bankRepo.setGold(player.m_accountId, bankGold, tab).catch((e: unknown) => { logger.warn({ err: e }, 'bank setGold failed'); });
  }

  private cloneSlot(src: InventorySlot, count: number): InventorySlot {
    const out: InventorySlot = { itemId: src.itemId, count };
    if (src.flags !== undefined) out.flags = src.flags;
    if (src.refine !== undefined) out.refine = src.refine;
    if (src.durability !== undefined) out.durability = src.durability;
    return out;
  }

  private inMainBag(slot: number): boolean {
    return slot >= 0 && slot < MAX_INVENTORY;
  }

  private findEmptyBank(player: CPlayer, tab: number): number {
    const t = player.m_Bank[tab];
    if (!t) return -1;
    for (let i = 0; i < BANK_SLOTS; i++) if (t[i] === null) return i;
    return -1;
  }

  private findEmptyInv(player: CPlayer): number {
    for (let i = 0; i < MAX_INVENTORY; i++) if (player.m_Inventory[i] === null) return i;
    return -1;
  }

  /** XZ distance check mirroring `CNpcChecker::IsCloseNpc` (npchecker.cpp:86). */
  private hasNearbyBankNpc(player: CPlayer): boolean {
    if (!this.deps.spawnManager) return false;
    for (const npc of this.deps.spawnManager.inZone(player.m_nZoneId)) {
      if (!npc.m_abMoverMenu.includes(MMI_BANKING)) continue;
      const dx = player.m_vPos.x - npc.m_vPos.x;
      const dz = player.m_vPos.z - npc.m_vPos.z;
      if (dx * dx + dz * dz <= MAX_LEN_MOVER_MENU_SQ) return true;
    }
    return false;
  }
}

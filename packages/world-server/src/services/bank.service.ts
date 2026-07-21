/**
 * BankService — bank open + item/gold deposit & withdraw.
 *
 * Ports `CDPSrvr::OnPutItemBank` / `OnGetItemBank` / `OnPutGoldBank` /
 * `OnGetGoldBank` (`WORLDSERVER/DPSrvr.cpp:3430/3791/3848/3900`). Bank is
 * account-shared (3 tabs × BANK_SLOTS). Moves items between the main bag and
 * `m_Bank[tab]`, gold between `m_nGold` and `m_BankGold[0]`. Each journals +
 * persists before the handler acks (PUTITEMBANK / GETITEMBANK / PUTGOLDBANK).
 *
 * The client drags optimistically; ack snapshots confirm the new bank/gold
 * state. Inventory-side changes the client applies locally (same model as
 * MOVEITEM).
 *
 * ponytail: per-tab gold (tabs 1/2), bank password, bank-to-bank transfer.
 *
 * @module services/bank
 */

import type { BankRepository, InventoryRepository, Journal } from '@flyff/database';
import { createLogger } from '@flyff/core/logger.js';
import type { CPlayer, InventorySlot } from '../entities/player.js';
import { MAX_INVENTORY, BANK_SLOTS, MAX_BANK_TABS } from '../net/snapshot/constants.js';

const logger = createLogger({ module: 'bank-service' });

export interface BankServiceDeps {
  bankRepo: Pick<BankRepository, 'setItem' | 'removeItem' | 'getGold' | 'setGold'>;
  inventoryRepo: Pick<InventoryRepository, 'removeItem' | 'setItem'>;
  journal?: Journal;
}

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

  /** Open the bank window for an NPC bank (dwId == NULL_ID). */
  open(player: CPlayer): boolean {
    player.m_bBankOpen = true;
    return true;
  }

  close(player: CPlayer): void {
    player.m_bBankOpen = false;
  }

  /** Move `count` from inv `invSlot` into the first empty slot of bank `tab`. */
  deposit(player: CPlayer, tab: number, invSlot: number, count: number): DepositResult {
    if (tab < 0 || tab >= MAX_BANK_TABS || !this.inMainBag(invSlot)) return { ok: false, reason: 'invalid' };
    const src = player.m_Inventory[invSlot];
    if (!src || count <= 0) return { ok: false, reason: 'invalid' };
    const bankSlot = this.findEmptyBank(player, tab);
    if (bankSlot === -1) return { ok: false, reason: 'bank_full' };

    const take = Math.min(count, src.count);
    const moved = this.cloneSlot(src, take);
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'BANK_DEPOSIT', payload: { tab, bankSlot, invSlot, itemId: src.itemId, take } });

    player.m_Bank[tab]![bankSlot] = moved;
    if (take >= src.count) {
      player.m_Inventory[invSlot] = null;
      this.deps.inventoryRepo.removeItem(player.m_idPlayer, invSlot).catch((e: unknown) => logger.warn({ err: e }, 'bank inv remove failed'));
    } else {
      src.count -= take;
      this.deps.inventoryRepo.setItem(player.m_idPlayer, invSlot, src.itemId, src.count, src.flags ?? 0, src.durability ?? -1, src.refine ?? 0).catch((e: unknown) => logger.warn({ err: e }, 'bank inv set failed'));
    }
    this.deps.bankRepo.setItem(player.m_accountId, tab, bankSlot, moved.itemId, moved.count, moved.flags ?? 0, moved.durability ?? -1, moved.refine ?? 0).catch((e: unknown) => logger.warn({ err: e }, 'bank set failed'));
    player._dirty.add('m_Inventory');
    return { ok: true, tab, bankSlot, item: moved };
  }

  /** Move `count` from bank `tab`/`bankSlot` into the first empty inv slot. */
  withdraw(player: CPlayer, tab: number, bankSlot: number, count: number): WithdrawResult {
    if (tab < 0 || tab >= MAX_BANK_TABS || bankSlot < 0 || bankSlot >= BANK_SLOTS) return { ok: false, reason: 'invalid' };
    const src = player.m_Bank[tab]![bankSlot];
    if (!src || count <= 0) return { ok: false, reason: 'invalid' };
    const invSlot = this.findEmptyInv(player);
    if (invSlot === -1) return { ok: false, reason: 'bag_full' };

    const take = Math.min(count, src.count);
    const moved = this.cloneSlot(src, take);
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'BANK_WITHDRAW', payload: { tab, bankSlot, invSlot, itemId: src.itemId, take } });

    player.m_Inventory[invSlot] = moved;
    if (take >= src.count) {
      player.m_Bank[tab]![bankSlot] = null;
      this.deps.bankRepo.removeItem(player.m_accountId, tab, bankSlot).catch((e: unknown) => logger.warn({ err: e }, 'bank remove failed'));
    } else {
      src.count -= take;
      this.deps.bankRepo.setItem(player.m_accountId, tab, bankSlot, src.itemId, src.count, src.flags ?? 0, src.durability ?? -1, src.refine ?? 0).catch((e: unknown) => logger.warn({ err: e }, 'bank set failed'));
    }
    this.deps.inventoryRepo.setItem(player.m_idPlayer, invSlot, moved.itemId, moved.count, moved.flags ?? 0, moved.durability ?? -1, moved.refine ?? 0).catch((e: unknown) => logger.warn({ err: e }, 'bank inv set failed'));
    player._dirty.add('m_Inventory');
    return { ok: true, tab, bankSlot, item: moved };
  }

  /** Move `amount` gold from inv into bank (tab 0 account gold). */
  depositGold(player: CPlayer, amount: number): GoldMoveResult {
    if (amount <= 0 || amount > player.m_nGold) return { ok: false, reason: 'invalid' };
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'BANK_GOLD_IN', payload: { amount } });
    player.m_nGold -= amount;
    player.m_BankGold[0] += amount;
    this.persistGold(player);
    return { ok: true, tab: 0, invGold: player.m_nGold, bankGold: player.m_BankGold[0] };
  }

  /** Move `amount` gold from bank into inv. */
  withdrawGold(player: CPlayer, amount: number): GoldMoveResult {
    if (amount <= 0 || amount > player.m_BankGold[0]) return { ok: false, reason: 'invalid' };
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'BANK_GOLD_OUT', payload: { amount } });
    player.m_BankGold[0] -= amount;
    player.m_nGold += amount;
    this.persistGold(player);
    return { ok: true, tab: 0, invGold: player.m_nGold, bankGold: player.m_BankGold[0] };
  }

  private persistGold(player: CPlayer): void {
    player._dirty.add('m_nGold');
    this.deps.bankRepo.setGold(player.m_accountId, player.m_BankGold[0]).catch((e: unknown) => logger.warn({ err: e }, 'bank setGold failed'));
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
    const t = player.m_Bank[tab]!;
    for (let i = 0; i < BANK_SLOTS; i++) if (t[i] === null) return i;
    return -1;
  }

  private findEmptyInv(player: CPlayer): number {
    for (let i = 0; i < MAX_INVENTORY; i++) if (player.m_Inventory[i] === null) return i;
    return -1;
  }
}

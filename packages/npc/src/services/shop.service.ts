/**
 * ShopService -- NPC vendor shop open/close.
 *
 * Ports the gate logic of `CDPSrvr::OnOpenShopWnd` / `OnCloseShopWnd`
 * (`WORLDSERVER/DPSrvr.cpp:2744/2793`). Open resolves the vendor by objid,
 * checks it is a trade NPC (`m_abMoverMenu` carries `MMI_TRADE`), refuses while
 * the bank window or another interaction is open, and records the vendor as the
 * player's "other" (C++ `m_vtInfo.SetOther`). Close clears it.
 *
 * ponytail: BUYITEM/SELLITEM trade against `m_idOther`; one-interaction-at-a-time
 * busy gate stays off by design (see comment in `open`) -- the per-call
 * `tradeVendor` re-validation is what actually prevents stale-vendor dupes.
 *
 * @module services/shop
 */

import { MMI_TRADE } from '@flyff/resources';
import type { SpawnManager } from '@flyff/world-core';
import type { CPlayer } from '@flyff/entities';
import type { VendorStock } from '@flyff/entities';
import type { InventoryService } from '@flyff/inventory';
import { MAX_INVENTORY, MAX_VENDOR_INVENTORY, MAX_VENDOR_INVENTORY_TAB } from '@flyff/world-core';

/** propItem fields the shop needs to price an item. */
interface ShopItemDef {
  readonly price?: number;
  readonly sellable?: boolean;
}

export type ShopOpenResult =
  | { ok: true; vendorId: number; stock: VendorStock }
  | { ok: false; reason: 'invalid' | 'not_vendor' | 'busy' };

export type BuyResult =
  | { ok: true; slot: number; objid: number; itemId: number; count: number; isNew: boolean; gold: number }
  | { ok: false; reason: 'no_vendor' | 'invalid' | 'no_stock' | 'no_gold' | 'bag_full' };

export type SellResult =
  | { ok: true; slot: number; itemId: number; remaining: number; gold: number }
  | { ok: false; reason: 'no_vendor' | 'invalid' | 'unsellable' | 'empty' };

export interface ShopServiceDeps {
  spawnManager: SpawnManager;
  /** Bag + gold mutation (addItem / consume / addGold / spendGold) -- all WAL-backed. */
  inventoryService: Pick<InventoryService, 'addItem' | 'consume' | 'addGold' | 'spendGold'>;
  /** propItem lookup for `price` / `sell_price` / `sellable`. */
  getItem: (id: number) => ShopItemDef | undefined;
}

export class ShopService {
  constructor(private readonly deps: ShopServiceDeps) {}

  /** Validate + open the vendor shop window for `player`. */
  open(player: CPlayer, vendorObjId: number): ShopOpenResult {
    if (!Number.isInteger(vendorObjId) || vendorObjId <= 0) return { ok: false, reason: 'invalid' };
    const vendor = this.deps.spawnManager.get(vendorObjId);
    if (!vendor) return { ok: false, reason: 'invalid' };
    // Monsters have no character.inc menus; only trade NPCs carry MMI_TRADE.
    if (!vendor.m_abMoverMenu.includes(MMI_TRADE)) return { ok: false, reason: 'not_vendor' };
    // C++ refuses when another vendor is already open (`m_vtInfo.GetOther()`) to
    // prevent trade-window dupes. We intentionally do NOT: BUYITEM/SELLITEM now
    // re-validate `m_idOther` against a live trade NPC on every call (see {@link
    // tradeVendor}), closing the stale-vendor dupe vector without the one-window
    // gate -- which the v19 client trips over because it does not always send
    // CLOSESHOPWND around the piercing/upgrade transition at a weapon shop
    // (SRT_WEAPON), leaving `m_idOther` stuck and locking the player out of every
    // shop until relog. Replacing the stale vendor here self-heals that.
    if (player.m_bBankOpen) return { ok: false, reason: 'busy' };

    player.m_idOther = vendor.m_idMover;
    return { ok: true, vendorId: vendor.m_idMover, stock: vendor.m_vendorStock };
  }

  /** Close the shop window (OnCloseShopWnd is bodyless -- just clear state). */
  close(player: CPlayer): void {
    player.m_idOther = null;
  }

    /**
   * BUYITEM (`OnBuyItem`, DPSrvr.cpp:2804) -- body `CHAR cTab, BYTE nId, short
   * nNum, DWORD dwItemId`. Validates the vendor is the player's current other
   * (`m_idOther`), the stock slot exists + matches `dwItemId` (anti-cheat: a
   * tampered client naming an out-of-stock or cheaper item is refused). Unit
   * cost is the propItem `price` floored to 1 (`OnBuyItem`'s `if(nCost<1) nCost=1`);
   * `nNum` is clamped to what the player's gold can cover (`gold / unitCost`),
   * matching C++ -- a request for more than affordable buys as many as possible,
   * and only when even one is unaffordable does it refuse (`no_gold`). Item add
   * + gold debit are both WAL-backed via {@link InventoryService}.
   * ponytail: `fShopCost` multiplier, event-lua buy factor, perin fixed-price
   * (PERIN_VALUE), purchase tax, and the 500 ms `__PERIN_BUY_BUG` re-buy gate.
   */
  buy(player: CPlayer, cTab: number, nId: number, nNum: number, dwItemId: number): BuyResult {
    const vendor = this.tradeVendor(player);
    if (!vendor) return { ok: false, reason: 'no_vendor' };
    if (!this.inVendorBounds(cTab, nId) || nNum <= 0 || !Number.isInteger(nNum)) return { ok: false, reason: 'invalid' };

    const stockSlot = vendor.m_vendorStock[cTab]![nId];
    if (!stockSlot || stockSlot.itemId !== dwItemId) return { ok: false, reason: 'no_stock' };

    const unitCost = Math.max(1, this.deps.getItem(dwItemId)?.price ?? 0);
    const affordable = Math.floor(player.m_nGold / unitCost);
    const qty = Math.min(nNum, affordable);
    if (qty < 1) return { ok: false, reason: 'no_gold' };

    const add = this.deps.inventoryService.addItem(player, dwItemId, qty);
    if (!add.ok) return { ok: false, reason: 'bag_full' };
    this.deps.inventoryService.spendGold(player, unitCost * qty); // qty <= affordable; always succeeds
    return { ok: true, slot: add.slot, objid: add.objid, itemId: add.itemId, count: add.count, isNew: add.isNew, gold: player.m_nGold };
  }

  /**
   * SELLITEM (`OnSellItem`, DPSrvr.cpp:3074) -- body `BYTE nId, short nNum`.
   * `nId` is the player's own inventory slot (no `dwItemId` echo -- C++ trusts
   * the slot alone, asymmetric vs. BUYITEM). Validates the vendor + slot is in
   * the main bag + item is sellable, then removes `nNum` via {@link
   * InventoryService.consume} and credits `floor(price / 4) * take` -- the C++
   * sell price is 25% of the buy cost (`GetCost()/4`), not a separate field.
   * Handler acks UPDATE_ITEM(slot, remaining) -- count 0 clears the slot -- plus
   * the new gold. ponytail: quest / equipped / perin / event-main blocks (C++
   * returns TID_GAME_EQUIPTRADE etc.); the 2.1 B overflow guard (our addGold
   * already clamps to MAX_GOLD).
   */
  sell(player: CPlayer, nId: number, nNum: number): SellResult {
    const vendor = this.tradeVendor(player);
    if (!vendor) return { ok: false, reason: 'no_vendor' };
    if (!Number.isInteger(nId) || nId < 0 || nNum <= 0 || !Number.isInteger(nNum)) {
      return { ok: false, reason: 'invalid' };
    }
    // Wire `nId` is the item's STABLE m_dwObjId (client `WndShop.cpp:244` sends
    // `m_pItemElem->m_dwObjId`), NOT a slot. Items move between slots on
    // equip/unequip/move, so resolve objid -> current slot via scan -- mirrors
    // C++ `GetAtId(nId)` over the stable m_apItem[objid] array (Item.h:515).
    // Treating nId as a slot breaks after the first move/equip (sell rejects
    // with `empty` on a visible, occupied item). Same trap as DOEQUIP/DOUSEITEM.
    const slot = player.findSlotByObjId(nId);
    if (slot < 0) return { ok: false, reason: 'empty' };
    // C++ blocks equipped items (IsEquip -> TID_GAME_EQUIPTRADE, DPSrvr.cpp:3103).
    // findSlotByObjId scans the full 73-slot range (bag + equip parts), so gate
    // equip slots (>= MAX_INVENTORY) here.
    if (slot >= MAX_INVENTORY) return { ok: false, reason: 'unsellable' };
    const src = player.m_Inventory[slot]!;
    if (!src) return { ok: false, reason: 'empty' };

    const def = this.deps.getItem(src.itemId);
    if (def?.sellable === false) return { ok: false, reason: 'unsellable' };

    const take = Math.min(nNum, src.count);
    const gain = Math.floor((def?.price ?? 0) / 4) * take;
    const after = this.deps.inventoryService.consume(player, slot, take);
    this.deps.inventoryService.addGold(player, gain);
    return { ok: true, slot, itemId: src.itemId, remaining: after?.count ?? 0, gold: player.m_nGold };
  }

  /** Resolve + validate the player's current trade vendor (m_idOther). */
  private tradeVendor(player: CPlayer): { m_vendorStock: VendorStock } | null {
    if (player.m_idOther === null) return null;
    const vendor = this.deps.spawnManager.get(player.m_idOther);
    if (!vendor || !vendor.m_abMoverMenu.includes(MMI_TRADE)) return null;
    return vendor;
  }

  private inVendorBounds(cTab: number, nId: number): boolean {
    return Number.isInteger(cTab) && cTab >= 0 && cTab < MAX_VENDOR_INVENTORY_TAB
      && Number.isInteger(nId) && nId >= 0 && nId < MAX_VENDOR_INVENTORY;
  }
}

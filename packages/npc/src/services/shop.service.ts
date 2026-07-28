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
  /** Raw IK3_* symbol (e.g. `IK3_EVENTMAIN`, `IK3_QUEST`). */
  readonly item_kind3?: string;
  /** Raw IK2_* symbol (e.g. `IK2_QUEST`). */
  readonly item_kind2?: string;
}

export type ShopOpenResult =
  | { ok: true; vendorId: number; stock: VendorStock }
  | { ok: false; reason: 'invalid' | 'not_vendor' | 'busy' | 'chaotic' };

export type BuyResult =
  | { ok: true; changes: Array<{ slot: number; objid: number; itemId: number; count: number; isNew: boolean }>; gold: number }
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
  /**
   * Global shop cost rate (`prj.m_fShopCost`, C++ `Project.h:968`). Defaults to 1.0.
   * Set by the database backend from GAME_SETTING; multiplied into every buy price.
   * ponytail: event-LUA factor (`GetShopBuyFactor`) and PERIN_VALUE conversion skipped.
   */
  shopCostRate?: number;
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
    // M9: C++ DPSrvr.cpp:2791 -- chaotic players (PK propensity > 0) are blocked
    // from opening shops. `prj.GetPropensityPenalty().nShop` gates access; we use
    // isChaotic() as the simpler gate (ponytail: upgrade to propensity-penalty
    // table when PK penalty system ships).
    if (player.isChaotic()) return { ok: false, reason: 'chaotic' };
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
   * cost is `floor(fShopCost * propItem.price)` floored to 1 (`OnBuyItem:2886,2910`).
   * `nNum` is first clamped to the vendor stock count (C++ `2874`), then to
   * what the player's gold can cover (`gold / unitCost`) -- a request for more
   * than affordable buys as many as possible, and only when even one is
   * unaffordable does it refuse (`no_gold`). Item add + gold debit are both
   * WAL-backed via {@link InventoryService}.
   * ponytail: event-lua buy factor, perin fixed-price (PERIN_VALUE), purchase
   * tax, and the 500 ms `__PERIN_BUY_BUG` re-buy gate.
   */
  buy(player: CPlayer, cTab: number, nId: number, nNum: number, dwItemId: number): BuyResult {
    const vendor = this.tradeVendor(player);
    if (!vendor) return { ok: false, reason: 'no_vendor' };
    if (!this.inVendorBounds(cTab, nId) || nNum <= 0 || !Number.isInteger(nNum)) return { ok: false, reason: 'invalid' };

    const stockSlot = vendor.m_vendorStock[cTab]![nId];
    if (!stockSlot || stockSlot.itemId !== dwItemId) return { ok: false, reason: 'no_stock' };

    // H13: clamp nNum to vendor stock (C++ DPSrvr.cpp:2874)
    nNum = Math.min(nNum, stockSlot.count);

    // H12: apply global fShopCost rate (C++ DPSrvr.cpp:2886)
    const rawPrice = this.deps.getItem(dwItemId)?.price ?? 0;
    const unitCost = Math.max(1, Math.floor((this.deps.shopCostRate ?? 1) * rawPrice));
    const affordable = Math.floor(player.m_nGold / unitCost);
    const qty = Math.min(nNum, affordable);
    if (qty < 1) return { ok: false, reason: 'no_gold' };

    const add = this.deps.inventoryService.addItem(player, dwItemId, qty);
    if (!add.ok) return { ok: false, reason: 'bag_full' };
    this.deps.inventoryService.spendGold(player, unitCost * qty); // qty <= affordable; always succeeds
    return { ok: true, changes: add.changes, gold: player.m_nGold };
  }

  /**
   * SELLITEM (`OnSellItem`, DPSrvr.cpp:3074) -- body `BYTE nId, short nNum`.
   * `nId` is the player's own inventory slot (no `dwItemId` echo -- C++ trusts
   * the slot alone, asymmetric vs. BUYITEM). Validates the vendor + slot is in
   * the main bag + item is sellable, then removes `nNum` via {@link
   * InventoryService.consume} and credits `max(1, floor(price / 4)) * take`
   * -- the C++ sell price is 25% of the buy cost (`GetCost()/4`) floored to 1,
   * not a separate field. Handler acks UPDATE_ITEM(slot, remaining) -- count 0
   * clears the slot -- plus the new gold.
   * **M10** (DPSrvr.cpp:3137-3154): blocks selling IK3_EVENTMAIN, quest
   * (IK2_QUEST/IK3_QUEST), sealed-char, and perin items.
   * **M11** (DPSrvr.cpp:3163-3168): `max(1, ...)` sell price floor.
   * ponytail: sealed-char + perin-by-id blocks (item ID constants not exported);
   * 2.1B overflow guard (our addGold already clamps to MAX_GOLD).
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

    // M10: C++ DPSrvr.cpp:3137-3154 -- block selling restricted item types.
    // Event main items (IK3_EVENTMAIN) cannot be sold at all.
    if (def?.item_kind3 === 'IK3_EVENTMAIN') return { ok: false, reason: 'unsellable' };
    // Quest items (C++ `IsQuest()`) cannot be sold.
    if (def?.item_kind2 === 'IK2_QUEST' || def?.item_kind3 === 'IK3_QUEST') return { ok: false, reason: 'unsellable' };
    // ponytail: sealed-char (II_SYS_SYS_SCR_SEALCHARACTER) and perin
    // (II_SYS_SYS_SCR_PERIN) blocks -- item ID constants not yet exported;
    // add when the seal/perin systems are ported.

    const take = Math.min(nNum, src.count);
    // M11: C++ DPSrvr.cpp:3163-3168 -- sell price floor of 1 penya per unit.
    // `max(1, GetCost()/4) * nNum`. Our addGold already clamps to MAX_GOLD.
    const gain = Math.max(1, Math.floor((def?.price ?? 0) / 4)) * take;
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

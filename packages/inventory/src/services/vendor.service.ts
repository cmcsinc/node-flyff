/**
 * VendorService -- the `CVTInfo` private-shop (vending) half, sibling of trade.
 *
 * Handlers (`WORLDSERVER/DPSrvr.cpp`): `OnPVendorOpen` :8959, `OnPVendorClose`
 * :9065, `OnRegisterPVendorItem` :9248, `OnUnregisterPVendorItem` :9228,
 * `OnQueryPVendorItem` :9197, `OnBuyPVendorItem` :9143. State model:
 * `CVendorInfo`/`CVTInfo` (`_Common/MoverItem.cpp:535-704`). Buy transaction:
 * `CVTInfo::VendorSellItem` (`MoverItem.cpp:636`).
 *
 * ## Flow
 *
 *   OPEN       -> set title (m_vtInfo.SetTitle); item listings arrive next
 *   REGISTER   -> VendorSetItem: a listing slot points at a live bag elem +
 *                 a per-unit price + quantity; echo REGISTER_PVENDOR_ITEM (self)
 *   UNREGISTER -> VendorClearItem; echo UNREGISTER_PVENDOR_ITEM (self)
 *   QUERY      -> SetOther(vendor), push full shop window (PVENDOR_ITEM) to buyer
 *   BUY        -> VendorSellItem: gold+item swap, broadcast PVENDOR_ITEM_NUM
 *   CLOSE      -> self: VendorClose + vicinity PVENDOR_CLOSE(clearTitle=1)
 *                 buyer: clear otherId + single-target PVENDOR_CLOSE(clearTitle=0)
 *
 * ## Dupe surface
 *
 * Like trade, listings reference the **live bag** (a pointer in C++, a slot id
 * here). The buy re-validates the listed slot against the live bag -- if it was
 * dropped/used/sold/moved between listing and buy, the buy aborts rather than
 * materializing an item that isn't there. WAL (rule 04): the buy journals
 * canonical absolute `INVENTORY_SLOT` + `CHAR_GOLD` on both sides before any ack
 * (folded into `InventoryService.addItem`/`spendGold`/`addGold`/`removeItem`).
 *
 * In-memory only -- C++ does not persist vendor state; the shop closes on
 * disconnect/relog. `onDisconnect` closes the shop + broadcasts.
 *
 * @module services/vendor
 */

import type { Journal } from '@flyff/database';
import { createLogger } from '@flyff/core/logger';
import type { CPlayer, VendorListing } from '@flyff/entities';
import {
  MAX_VENDITEM, MAX_VENDOR_REVISION, MAX_VENDORNAME, MAX_INVENTORY,
} from '@flyff/entities';
import type { PlayerManager, ZoneManager } from '@flyff/world-core';
import { VISIBILITY_RADIUS } from '@flyff/world-core';
import { buildSetPointParam, DST_GOLD } from '@flyff/world-core';
import type { InventoryService } from './inventory.service';
import { CreateItemSnapshotSerializer } from '../net/snapshot/createItem.serializer';
import { buildUpdateItemCount } from '../net/snapshot/updateItem.serializer';
import {
  buildPVendorOpen, buildPVendorClose, buildRegisterPVendorItem,
  buildPVendorItem, buildPVendorItemNum, buildUnregisterPVendorItem,
  type VendorItemView,
} from '../net/snapshot/vendor.serializer';

const logger = createLogger({ module: 'vendor-service' });

/** Minimal item-prop view the vendor gates need (mirrors TradeItemProp). */
export interface VendorItemProp {
  readonly stack_size?: number | undefined;
  readonly item_kind3?: string | undefined;
}

export interface VendorServiceDeps {
  playerManager: PlayerManager;
  zoneManager: ZoneManager;
  inventoryService: Pick<InventoryService, 'addItem' | 'spendGold' | 'addGold' | 'removeItem'>;
  createItemSerializer?: CreateItemSnapshotSerializer;
  getItemProp?: (itemId: number) => VendorItemProp | undefined;
  /** Emits a `TID_*` notice to one player (DEFINEDTEXT). */
  sendDefinedText?: (player: CPlayer, tid: number) => void;
  journal?: Journal;
}

export type VendorResult =
  | { ok: true }
  | { ok: false; reason: string };

const OK: VendorResult = { ok: true };
const fail = (reason: string): VendorResult => ({ ok: false, reason });

/** `TID_GAME_LACKMONEY` / `LACKSPACE` / `FAIL_TO_OPEN_SHOP` (defineText.h). */
const TID_GAME_LACKMONEY = 625;
const TID_GAME_LACKSPACE = 626;
const TID_GAME_FAIL_TO_OPEN_SHOP = 3198;
const TID_GAME_CANNOT_DO_USINGITEM = 1927;

export class VendorService {
  private readonly createItemSerializer: CreateItemSnapshotSerializer;

  constructor(private readonly deps: VendorServiceDeps) {
    this.createItemSerializer = deps.createItemSerializer ?? new CreateItemSnapshotSerializer();
  }

  // ── OPEN / CLOSE ──────────────────────────────────────────────────────────

  /**
   * `OnPVendorOpen` (`DPSrvr.cpp:8959`) -- set the shop title. Listings arrive
   * via subsequent REGISTER packets. Guards mirror the C++ chain; worlds we
   * don't model (guild-war/miniroom/quiz) and the chaotic-Propensity penalty
   * are ponytail'd.
   */
  open(player: CPlayer, title: string, now = Date.now()): VendorResult {
    const trimmed = title.slice(0, MAX_VENDORNAME - 1);
    if (player.m_vtInfo.busy) return fail('busy');           // GetOther != NULL
    if (player.m_nDuel > 0) return fail('duel');
    if (isAttackMode(player, now)) return fail('attack-mode');
    // ponytail: IsFly() -- no flight state yet; IsChaotic() Propensity.nVendor
    // -- no PK penalty table; guild-war/miniroom worlds -- absent.
    player.m_vtInfo.title = trimmed;
    // C++ broadcasts AddPVendorOpen only inside the `VendorIsVendor()` branch --
    // i.e. items were registered first (REGISTER gates on `!IsVendorOpen`, so
    // the configure-then-open order is enforced). A title-only open with no
    // listings sends nothing; the ADD_OBJ title field carries the sign to peers
    // who stream in later.
    if (player.m_vtInfo.isVending) {
      this.deps.zoneManager.broadcastAround(
        player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
        buildPVendorOpen(player.m_idPlayer, trimmed),
      );
    }
    logger.info({ charId: player.m_idPlayer, title: trimmed }, 'vendor open');
    return OK;
  }

  /**
   * `OnPVendorClose` / `ClosePVendor` (`DPSrvr.cpp:9065/9077`). `objidVendor`
   * is the mover the close refers to: if SELF, the vendor shuts its own shop
   * (vicinity PVENDOR_CLOSE clearTitle=1); otherwise the buyer is dropping their
   * view of that vendor (single-target PVENDOR_CLOSE clearTitle=0).
   */
  close(player: CPlayer, objidVendor: number): VendorResult {
    if (objidVendor === player.m_idPlayer) {
      return this.closeOwn(player);
    }
    if (player.m_vtInfo.otherId === objidVendor) {
      player.m_vtInfo.otherId = null;
      this.deps.playerManager.sendTo(player, buildPVendorClose(objidVendor, false));
      return OK;
    }
    return fail('not-browsing');
  }

  private closeOwn(player: CPlayer): VendorResult {
    if (!player.m_vtInfo.vendorOpen && !player.m_vtInfo.isVending) return fail('not-open');
    player.m_vtInfo.vendorClose();
    // Vicinity: peers clear the seller's title + close any open browse window.
    this.deps.zoneManager.broadcastAround(
      player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
      buildPVendorClose(player.m_idPlayer, true),
    );
    logger.info({ charId: player.m_idPlayer }, 'vendor close');
    return OK;
  }

  // ── REGISTER / UNREGISTER ─────────────────────────────────────────────────

  /**
   * `OnRegisterPVendorItem` (`DPSrvr.cpp:9248`). `nId` is the item's stable
   * objid (resolved via `findSlotByObjId`, same convention as trade put /
   * DOEQUIP). Guards in C++ source order; the bound/guild-cloak/ride item flags
   * aren't modelled on `InventorySlot` today, so only quest + equipped are
   * enforced (ponytail -- same surface trade stubs).
   */
  registerItem(
    player: CPlayer, iIndex: number, nId: number, nNum: number, nCost: number,
  ): VendorResult {
    if (iIndex < 0 || iIndex >= MAX_VENDOR_REVISION) return fail('bad-index');
    if (player.m_vtInfo.busy) return fail('busy');
    if (player.m_vtInfo.vendorOpen) return fail('already-open');

    const cost = Math.max(1, Math.floor(nCost));
    const slot = player.findSlotByObjId(nId);
    if (slot < 0) return fail('no-item');
    const refusal = this.checkListable(player, slot);
    if (refusal !== 0) {
      this.deps.sendDefinedText?.(player, refusal);
      logger.info({ charId: player.m_idPlayer, nId, slot, tid: refusal }, 'vendor register refused');
      return fail('refused');
    }

    const item = player.m_Inventory[slot];
    if (!item) return fail('no-item');
    const count = Math.min(Math.max(1, nNum), item.count);
    const listing: VendorListing = {
      bagSlot: slot, objid: item.objid ?? slot, itemId: item.itemId, count, cost,
    };
    player.m_vtInfo.listings[iIndex] = listing;
    this.deps.playerManager.sendTo(
      player, buildRegisterPVendorItem(player.m_idPlayer, iIndex, 0, nId, count, cost));
    logger.info(
      { charId: player.m_idPlayer, iIndex, nId, slot, itemId: item.itemId, count, cost },
      'vendor register');
    return OK;
  }

  /** `OnUnregisterPVendorItem` (`DPSrvr.cpp:9228`) -- drop listing `i`. */
  unregisterItem(player: CPlayer, i: number): VendorResult {
    if (i < 0 || i >= MAX_VENDITEM) return fail('bad-index');
    if (player.m_vtInfo.busy) return fail('busy');
    if (player.m_vtInfo.vendorOpen) return fail('already-open');
    if (!player.m_vtInfo.vendorClearItem(i)) return fail('empty');
    this.deps.playerManager.sendTo(player, buildUnregisterPVendorItem(player.m_idPlayer, i));
    return OK;
  }

  // ── QUERY (browse) ────────────────────────────────────────────────────────

  /**
   * `OnQueryPVendorItem` (`DPSrvr.cpp:9197`) -- link buyer to vendor and push
   * the full shop window. `bState` is the chatting-room flag; we hardcode 1
   * (TS has no chatting room).
   */
  query(player: CPlayer, objidVendor: number): VendorResult {
    if (player.m_vtInfo.busy) return fail('busy');
    // ponytail: IsFly() -- no flight state yet.
    const vendor = this.deps.playerManager.get(objidVendor);
    if (!vendor?.m_vtInfo.vendorOpen) return fail('no-vendor');

    player.m_vtInfo.otherId = objidVendor;
    const views: VendorItemView[] = [];
    for (const i of vendor.m_vtInfo.occupiedListings()) {
      const l = vendor.m_vtInfo.listings[i];
      if (!l) continue;
      const slot = vendor.m_Inventory[l.bagSlot];
      if (!slot) continue;   // listed elem since dropped -- skip in the window
      views.push({ iIndex: i, objId: l.objid, slot, nExtra: l.count, nCost: l.cost });
    }
    this.deps.playerManager.sendTo(player, buildPVendorItem(objidVendor, views, 1));
    logger.info({ buyer: player.m_idPlayer, vendor: objidVendor, items: views.length }, 'vendor query');
    return OK;
  }

  // ── BUY (the transaction) ─────────────────────────────────────────────────

  /**
   * `OnBuyPVendorItem` -> `CVTInfo::VendorSellItem` (`DPSrvr.cpp:9143` /
   * `MoverItem.cpp:636`). No positive ack -- the buyer sees gold drop + item
   * arrive; errors send `DEFINEDTEXT(TID)`. Re-validates the listing against
   * the live bag; partial-bag-full cannot happen (buyer space is pre-checked).
   */
  buy(
    buyer: CPlayer, objidVendor: number, nItem: number, dwItemId: number, nNumIn: number,
  ): VendorResult {
    if (nItem < 0 || nItem >= MAX_VENDITEM || nNumIn <= 0) return fail('bad-args');
    const vendor = this.deps.playerManager.get(objidVendor);
    if (!vendor?.m_vtInfo.vendorOpen) return fail('no-vendor');

    const listing = vendor.m_vtInfo.listings[nItem];
    if (!listing) return fail('empty-slot');
    // Re-validate the listing against the live bag (drop/use/sell since list).
    const live = vendor.m_Inventory[listing.bagSlot];
    if (!live || live.itemId !== dwItemId || (live.objid ?? listing.bagSlot) !== listing.objid) {
      logger.warn(
        { vendor: objidVendor, nItem, listed: listing.itemId, live: live?.itemId },
        'vendor buy: listing drifted');
      return fail('drifted');
    }

    const nNum = Math.min(nNumIn, listing.count);
    if (nNum <= 0) return fail('none');
    const totalPrice = Math.imul(nNum, listing.cost);

    // Gold + space gates BEFORE any mutation (C++: LACKMONEY then LACKSPACE).
    if (buyer.m_nGold < totalPrice) {
      this.deps.sendDefinedText?.(buyer, TID_GAME_LACKMONEY);
      return fail('lackmoney');
    }
    if (!this.hasSpace(buyer, dwItemId, nNum)) {
      this.deps.sendDefinedText?.(buyer, TID_GAME_LACKSPACE);
      return fail('lackspace');
    }

    // --- Apply. addItem/spendGold/addGold/removeItem each WAL + persist. ---
    const r = this.deps.inventoryService.addItem(buyer, dwItemId, nNum);
    if (!r.ok) {                     // race: space vanished between check and add
      this.deps.sendDefinedText?.(buyer, TID_GAME_LACKSPACE);
      return fail('lackspace-race');
    }
    this.deliverItem(buyer, r.changes);
    this.deps.inventoryService.spendGold(buyer, totalPrice);
    this.deps.inventoryService.addGold(vendor, totalPrice);
    const rem = this.deps.inventoryService.removeItem(vendor, listing.bagSlot, nNum);

    // --- Listing remainder + broadcast. ---
    vendor.m_vtInfo.vendorItemNum(nItem, listing.count - nNum);
    this.deps.playerManager.sendTo(
      buyer, buildSetPointParam(buyer.m_idPlayer, DST_GOLD, buyer.m_nGold));
    this.deps.playerManager.sendTo(
      vendor, buildSetPointParam(vendor.m_idPlayer, DST_GOLD, vendor.m_nGold));
    const vendorObjId = live.objid;
    const remaining = rem.ok ? rem.remaining : 0;
    if (vendorObjId !== undefined) {
      this.deps.playerManager.sendTo(
        vendor, buildUpdateItemCount(vendor.m_idPlayer, vendorObjId, remaining));
    }
    this.broadcastItemNum(vendor, nItem, listing.count - nNum, buyer);

    logger.info({
      buyer: buyer.m_idPlayer, vendor: objidVendor, nItem, itemId: dwItemId,
      nNum, cost: totalPrice, remain: listing.count,
    }, 'vendor buy');
    return OK;
  }

  // ── Disconnect ────────────────────────────────────────────────────────────

  /**
   * Disconnect hook -- C++ `ClosePVendor` runs in the mover teardown. Closes
   * the shop (vicinity broadcast) if vending, and clears any browse pointer.
   */
  onDisconnect(player: CPlayer): void {
    if (player.m_vtInfo.isVending || player.m_vtInfo.vendorOpen) {
      player.m_vtInfo.vendorClose();
      this.deps.zoneManager.broadcastAround(
        player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS,
        buildPVendorClose(player.m_idPlayer, true));
    }
    player.m_vtInfo.otherId = null;
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  /** Per-slot broadcast of a fresh/merged item, keyed by the client's objid. */
  private deliverItem(buyer: CPlayer, changes: readonly { isNew: boolean; itemId: number; count: number; objid: number }[]): void {
    for (const ch of changes) {
      this.deps.playerManager.sendTo(
        buyer,
        ch.isNew
          ? this.createItemSerializer.buildOne(buyer.m_idPlayer, ch.itemId, ch.count, ch.objid)
          : buildUpdateItemCount(buyer.m_idPlayer, ch.objid, ch.count),
      );
    }
  }

  /** `AddPVendorItemNum` targeting: vendor + anyone currently browsing them. */
  private broadcastItemNum(vendor: CPlayer, nItem: number, nVend: number, buyer: CPlayer): void {
    const packet = buildPVendorItemNum(vendor.m_idPlayer, nItem, nVend, buyer.m_szName);
    this.deps.playerManager.sendTo(vendor, packet);
    for (const p of this.deps.playerManager.all()) {
      if (p !== vendor && p.m_vtInfo.otherId === vendor.m_idPlayer) {
        this.deps.playerManager.sendTo(p, packet);
      }
    }
  }

  /**
   * `hasSpace` -- read-only pre-check mirroring `InventoryService.addItem`'s
   * merge-then-place, so `addItem(buyer, itemId, nNum)` cannot partial-fail.
   */
  private hasSpace(buyer: CPlayer, itemId: number, nNum: number): boolean {
    const stackSize = Math.max(1, this.deps.getItemProp?.(itemId)?.stack_size ?? 1);
    let need = nNum;
    for (let i = 0; i < MAX_INVENTORY && need > 0; i++) {
      const s = buyer.m_Inventory[i];
      if (!s) {
        need -= stackSize;                      // fresh slot holds a full stack
      } else if (s.itemId === itemId && (s.flags ?? 0) === 0) {
        need -= Math.max(0, stackSize - s.count); // headroom on a partial stack
      }
    }
    return need <= 0;
  }

  /**
   * Listing eligibility -- ports the `OnRegisterPVendorItem` refused-chain
   * (`DPSrvr.cpp:9290-9340`). Enforces bag-range (equipped lives at
   * `>= MAX_INVENTORY`) + quest (IK3_QUEST). Bound/guild-cloak/ride/expired are
   * not modelled on the slot today (ponytail: add when item-binding ships).
   */
  private checkListable(player: CPlayer, slot: number): number {
    if (slot < 0 || slot >= MAX_INVENTORY) return TID_GAME_FAIL_TO_OPEN_SHOP;
    const item = player.m_Inventory[slot];
    if (!item || item.count <= 0) return TID_GAME_FAIL_TO_OPEN_SHOP;
    // An equipped item lives at >= MAX_INVENTORY, so the range check covers
    // `IsEquip`; a bag-range slot can never be equipped.
    const prop = this.deps.getItemProp?.(item.itemId);
    if (prop?.item_kind3 === 'IK3_QUEST') return TID_GAME_CANNOT_DO_USINGITEM;
    // Already listed in another slot? (C++ IsTrading over the vendor array.)
    if (player.m_vtInfo.occupiedListings().some(
      (i) => player.m_vtInfo.listings[i]?.bagSlot === slot,
    )) return TID_GAME_CANNOT_DO_USINGITEM;
    return 0;
  }
}

/** Damaged within the last 10 s (`m_nAtkCnt < SEC1*10`) -- blocks vendor open. */
function isAttackMode(player: CPlayer, now: number): boolean {
  return player.m_tmLastDamage > 0 && now - player.m_tmLastDamage < 10_000;
}

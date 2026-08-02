/**
 * Trade constants + `CVTInfo` trade state (`_Common/Mover.h:354`).
 *
 * The trade window is a 25-slot staging area per side. Items are NOT moved out
 * of the bag when staged -- C++ keeps a pointer in `m_apItem_VT[i]` and stamps
 * the staged count into the item's `SetExtra()`. The actual transfer happens
 * once, atomically, in `TradeConsent` (`MoverItem.cpp:126`). Gold is the
 * exception: `OnTradePutGold` (DPSrvr.cpp:8807) debits the bag immediately and
 * `TradeClear` refunds it, so an aborted trade must always run through Clear.
 *
 * @module entities/trade
 */

/** `MAX_TRADE` (`_Common/ProjectCmn.h:11`) -- trade-window slots per side. */
export const MAX_TRADE = 25;

/**
 * `MAX_VENDITEM` (`ProjectCmn.h:12`) -- private-shop listing slots. C++ stores
 * these in the same `m_apItem_VT[30]` array it lends to trade, but trade (0..24)
 * and vendor (0..29) are mutually exclusive (both need `GetOther()==NULL`), so
 * the TS port keeps a separate `listings[30]` -- no path can touch both at once.
 */
export const MAX_VENDITEM = 30;

/**
 * `MAX_VENDOR_REVISION` (`ProjectCmn.h:47`, `__VER>=8` gate) -- the `iIndex`
 * ceiling for REGISTER/UNREGISTER_PVENDOR_ITEM. NOT MAX_VENDITEM: a v19 client
 * only ever addresses listing slots 0..19.
 */
export const MAX_VENDOR_REVISION = 20;

/** `MAX_VENDORNAME` (`ProjectCmn.h:14`) -- shop-title buffer (chars). */
export const MAX_VENDORNAME = 48;

/**
 * `TRADE_STATE` (`_Common/Mover.h:196`). Both sides must be in the same step for
 * put/pull to be accepted; OK and CONFIRM are the two-phase commit.
 */
export const TRADE_STEP = Object.freeze({
  /** Staging -- items/gold can be added and removed. */
  ITEM: 0,
  /** This side pressed OK. */
  OK: 1,
  /** This side pressed the final confirm. Both in CONFIRM => commit. */
  CONFIRM: 2,
} as const);

export type TradeStep = typeof TRADE_STEP[keyof typeof TRADE_STEP];

/**
 * `TID_GAME_CANNOTTRADE_ITEM` (`resource/defineText.h`) -- the blanket refusal
 * `TradeSetItem2` (`MoverItem.cpp:210`) returns for an untradeable item.
 */
export const TID_GAME_CANNOTTRADE_ITEM = 462;
/** `TID_GAME_CANNOT_DO_USINGITEM` -- item is in use (equipped/active). */
export const TID_GAME_CANNOT_DO_USINGITEM = 1927;

/**
 * One staged trade-window entry. Mirrors the `m_apItem_VT[i]` pointer plus the
 * `SetExtra(nItemNum)` staged count: we hold the bag slot rather than a pointer,
 * so a concurrent bag mutation is caught at commit time by re-reading the slot.
 */
export interface TradeStake {
  /** Bag slot the item lives in (still owned by the bag until commit). */
  readonly slot: number;
  /** The item's stable `m_dwObjId`, re-checked at commit to detect swaps. */
  readonly objid: number;
  /** propItem id, re-checked at commit. */
  readonly itemId: number;
  /** Staged count (C++ `GetExtra()`); <= the slot's live count. */
  readonly count: number;
}

/**
 * One private-shop listing. C++ stores a pointer into the live bag elem plus
 * `SetExtra(count)` (quantity sold in this listing) and `m_nCost` (per-unit
 * price); we hold the bag slot + identity so a concurrent bag mutation
 * (drop/use/sell) is caught at buy time by re-reading the slot. The quantity
 * being sold lives here, NOT on the bag elem -- only the buy decrements it.
 *
 * `bagSlot`/`objid`/`itemId` identify the bag elem the listing points at;
 * `count` is the remaining listing quantity (C++ `GetExtra()`); `cost` is the
 * per-unit price (C++ `m_nCost`).
 */
export interface VendorListing {
  /** Bag slot the listed item lives in. */
  readonly bagSlot: number;
  /** The item's stable `m_dwObjId`, re-checked at buy to detect swaps. */
  readonly objid: number;
  /** propItem id, re-checked at buy. */
  readonly itemId: number;
  /** Quantity remaining in this listing (C++ `GetExtra()`). */
  count: number;
  /** Per-unit price (C++ `m_nCost`). */
  readonly cost: number;
}

/**
 * `CVTInfo` -- per-player trade state. One instance per `CPlayer`, reused across
 * trades (C++ `Init` then `TradeClear` between sessions).
 *
 * `otherId` doubles as the "am I busy" flag: `OnTrade`/`OnConfirmTrade` both
 * require `GetOther() == NULL` on BOTH sides before anything starts.
 */
export class VTInfo {
  /** Character id of the trade partner, or `null` when idle. */
  otherId: number | null = null;
  /** Gold staged in the window. Already debited from the bag (see module doc). */
  gold = 0;
  /** Staged items by window index (0..MAX_TRADE-1). */
  readonly items: (TradeStake | null)[] = Array.from({ length: MAX_TRADE }, () => null);
  /** Current step. */
  state: TradeStep = TRADE_STEP.ITEM;

  // ── Private shop (vendor) state ──────────────────────────────────────────
  // C++ `m_vtInfo.GetTitle()` / `SetTitle()` / `IsVendorOpen()` /
  // `VendorIsVendor()` / `VendorClose()` / `VendorClearItem()` /
  // `VendorItemNum()` (`_Common/MoverItem.cpp:535-610`). `""` title = closed.
  /** Shop title (`m_strTitle`); `""` = no shop open. */
  title = '';
  /** Listing slots (0..MAX_VENDITEM-1), each pointing at a live bag elem. */
  readonly listings: (VendorListing | null)[] = Array.from({ length: MAX_VENDITEM }, () => null);

  /** `IsVendorOpen()` (`MoverItem.cpp:57`) -- TRUE iff a title is set. */
  get vendorOpen(): boolean {
    return this.title !== '';
  }
  /** `VendorIsVendor()` (`MoverItem.cpp:614`) -- TRUE iff any item is listed. */
  get isVending(): boolean {
    return this.listings.some((l) => l !== null);
  }

  /** True while this player is in a trade (or has a vendor open, once ported). */
  get busy(): boolean {
    return this.otherId !== null;
  }

  /** Occupied window indices, ascending. */
  occupied(): number[] {
    const out: number[] = [];
    for (let i = 0; i < MAX_TRADE; i++) if (this.items[i]) out.push(i);
    return out;
  }

  /**
   * `CVTInfo::TradeClear` (`MoverItem.cpp:74`) minus the gold refund, which the
   * caller must perform (it needs the bag). Resets partner, stakes and step.
   */
  clear(): void {
    this.otherId = null;
    this.items.fill(null);
    this.gold = 0;
    this.state = TRADE_STEP.ITEM;
  }

  // ── Private shop (vendor) methods ────────────────────────────────────────

  /** Occupied listing indices, ascending. */
  occupiedListings(): number[] {
    const out: number[] = [];
    for (let i = 0; i < MAX_VENDITEM; i++) if (this.listings[i]) out.push(i);
    return out;
  }

  /**
   * `CVTInfo::VendorClose(BOOL bClearTitle=TRUE)` (`MoverItem.cpp:590`). Clears
   * every listing slot, drops the title, and releases any browse partner. The
   * caller broadcasts the close; this only mutates state.
   */
  vendorClose(): void {
    this.listings.fill(null);
    this.title = '';
    this.otherId = null;
  }

  /**
   * `CVTInfo::VendorClearItem(BYTE i)` (`MoverItem.cpp:535`). Clears one listing
   * slot. Returns false if it was already empty (C++ returns FALSE in that case).
   */
  vendorClearItem(i: number): boolean {
    if (i < 0 || i >= MAX_VENDITEM || !this.listings[i]) return false;
    this.listings[i] = null;
    return true;
  }

  /**
   * `CVTInfo::VendorItemNum(BYTE i, short nNum)` (`MoverItem.cpp:565`). Sets the
   * remaining quantity on a listing; clears the slot when it hits 0 (C++ also
   * NULLs the pointer there).
   */
  vendorItemNum(i: number, nNum: number): void {
    const l = this.listings[i];
    if (!l) return;
    if (nNum <= 0) { this.listings[i] = null; return; }
    l.count = nNum;
  }
}

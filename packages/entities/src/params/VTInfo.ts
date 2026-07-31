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
  readonly items: (TradeStake | null)[] = new Array(MAX_TRADE).fill(null);
  /** Current step. */
  state: TradeStep = TRADE_STEP.ITEM;

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
}

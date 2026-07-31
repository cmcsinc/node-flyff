/**
 * TradeService -- the `CVTInfo` trade state machine (10 opcodes).
 *
 * Handlers (`WORLDSERVER/DPSrvr.cpp`): `OnConfirmTrade` :8683,
 * `OnConfirmTradeCancel` :8729, `OnTrade` :8626, `OnTradePut` :8737,
 * `OnTradePull` :8781, `OnTradePutGold` :8807, `OnTradeCancel` :8858,
 * `OnTradeOk` :8926, `OnTradelastConfrim` :8877. Commit logic is
 * `CVTInfo::TradeConsent` (`_Common/MoverItem.cpp:126`).
 *
 * ## Flow
 *
 *   CONFIRMTRADE  -> popup on target (no state claimed)
 *   TRADE         -> both SetOther, both get the other's inventory; step=ITEM
 *   PUT/PULL/GOLD -> only while BOTH sides are at step ITEM
 *   OK            -> step=OK; when both are OK, both get TRADELASTCONFIRM
 *   TRADECONFIRM  -> first side: step=CONFIRM + LASTCONFIRMOK to both
 *                    second side: commit -> TRADECONSENT to both
 *   CANCEL        -> both TradeClear (refunding staged gold) + TRADECANCEL
 *
 * ## Two things that cause dupes if got wrong
 *
 * 1. **Items are NOT escrowed.** C++ stages a bag pointer + `SetExtra(count)`
 *    and only moves anything in `TradeConsent`. We stage `{slot, objid, itemId,
 *    count}` and **re-validate every stake against the live bag at commit
 *    time** -- if a slot was emptied, swapped, or shrunk between staging and
 *    commit (drop, use, sell, another trade), the commit aborts with
 *    TRADE_CONFIRM_ERROR rather than materializing an item that isn't there.
 *    C++ leans on the pointer staying valid; a re-check is strictly safer and
 *    changes no successful-path behavior.
 * 2. **Gold IS escrowed immediately.** `OnTradePutGold` (DPSrvr.cpp:8827) calls
 *    `AddGold( -nGold )` at stake time, and `TradeClear` (`MoverItem.cpp:83`)
 *    refunds it. Every abort path -- cancel, disconnect, commit error -- MUST
 *    run through {@link TradeService.clearSide} or the staged gold vanishes.
 *
 * WAL (rule 04): the commit journals canonical absolute `INVENTORY_SLOT` for
 * every touched slot on BOTH characters plus `CHAR_GOLD` for both, before any
 * ack. Gold stake/refund also journal, since they mutate the bag immediately.
 *
 * @module services/trade
 */

import type { Journal, InventoryRepository } from '@flyff/database';
import { MAX_GOLD } from '@flyff/core';
import { createLogger } from '@flyff/core/logger';
import type { CPlayer, InventorySlot } from '@flyff/entities';
import {
  MAX_TRADE, TRADE_STEP, MAX_INVENTORY,
  TID_GAME_CANNOTTRADE_ITEM, TID_GAME_CANNOT_DO_USINGITEM,
} from '@flyff/entities';
import type { PlayerManager } from '@flyff/world-core';
import { NULL_ID } from '@flyff/world-core';
import {
  buildTrade, buildConfirmTrade, buildConfirmTradeCancel, buildTradePut,
  buildTradePull, buildTradePutError, buildTradePutGold, buildTradeCancel,
  buildTradeOk, buildTradeLastConfirm, buildTradeLastConfirmOk, buildTradeConsent,
} from '../net/snapshot/trade.serializer';

const logger = createLogger({ module: 'trade-service' });

/**
 * Minimal item-prop view the trade gates need (`TradeSetItem2`). Fields are
 * `| undefined` rather than plain optional so a resource record whose keys are
 * present-but-undefined assigns cleanly under `exactOptionalPropertyTypes`.
 */
export interface TradeItemProp {
  readonly stack_size?: number | undefined;
  readonly item_kind3?: string | undefined;
  readonly tradeable?: boolean | undefined;
}

export interface TradeServiceDeps {
  playerManager: PlayerManager;
  inventoryRepo: Pick<InventoryRepository, 'setItem' | 'removeItem' | 'setGold'>;
  getItemProp?: (itemId: number) => TradeItemProp | undefined;
  /** Emits a `TID_*` notice to one player (DEFINEDTEXT). */
  sendDefinedText?: (player: CPlayer, tid: number) => void;
  journal?: Journal;
}

export type TradeResult =
  | { ok: true }
  | { ok: false; reason: string };

const OK: TradeResult = { ok: true };
const fail = (reason: string): TradeResult => ({ ok: false, reason });

/** One player's planned end-state for a commit. */
interface SidePlan {
  readonly player: CPlayer;
  /** Slot -> new content (`null` = becomes empty). Only touched slots appear. */
  readonly slots: Map<number, InventorySlot | null>;
  /** Items this side hands to the partner (populated by `collectOutgoing`). */
  readonly outgoing: InventorySlot[];
}

/** Both sides' end-state, including post-swap gold. */
interface TradeSwapPlan {
  readonly a: SidePlan & { readonly gold: number };
  readonly b: SidePlan & { readonly gold: number };
}

export class TradeService {
  constructor(private readonly deps: TradeServiceDeps) {}

  // ── Opening ───────────────────────────────────────────────────────────────

  /**
   * `OnConfirmTrade` (DPSrvr.cpp:8683) -- ask `targetCharId` to trade. Claims no
   * state; just pops the confirm window. Both sides must be idle, and an
   * in-combat target (`IsAttackMode`, 10 s since last damage) refuses.
   */
  confirmTrade(player: CPlayer, targetCharId: number, now = Date.now()): TradeResult {
    if (player.m_vtInfo.busy) return fail('busy');
    if (player.m_idPlayer === targetCharId) return fail('self');
    const target = this.deps.playerManager.get(targetCharId);
    if (!target) return fail('not-found');
    if (target.m_vtInfo.busy) return fail('target-busy');
    if (player.m_nDuel > 0 || target.m_nDuel > 0) return fail('duel');

    // TID_GAME_BATTLE_NOTTRADE -- target took damage in the last 10 s.
    if (isAttackMode(target, now)) {
      this.deps.sendDefinedText?.(player, TID_GAME_BATTLE_NOTTRADE);
      return fail('target-in-combat');
    }
    this.deps.playerManager.sendTo(target, buildConfirmTrade(player.m_idPlayer));
    return OK;
  }

  /** `OnConfirmTradeCancel` (DPSrvr.cpp:8729) -- dismiss the popup. */
  confirmTradeCancel(player: CPlayer, targetCharId: number): TradeResult {
    const target = this.deps.playerManager.get(targetCharId);
    if (!target) return fail('not-found');
    this.deps.playerManager.sendTo(target, buildConfirmTradeCancel(player.m_idPlayer));
    return OK;
  }

  /**
   * `OnTrade` (DPSrvr.cpp:8626) -- the accept leg. Links both `CVTInfo`s and
   * ships each side the OTHER's inventory. Re-runs every gate: C++ checks
   * `GetOther() == NULL` on both sides here too, because the popup claimed
   * nothing and either party may have started a different trade meanwhile.
   */
  trade(player: CPlayer, targetCharId: number): TradeResult {
    if (player.m_vtInfo.busy) return fail('busy');
    const target = this.deps.playerManager.get(targetCharId);
    if (!target) return fail('not-found');
    if (target.m_vtInfo.busy) return fail('target-busy');
    if (player.m_nDuel > 0 || target.m_nDuel > 0) return fail('duel');

    player.m_vtInfo.otherId = target.m_idPlayer;
    target.m_vtInfo.otherId = player.m_idPlayer;
    player.m_vtInfo.state = TRADE_STEP.ITEM;
    target.m_vtInfo.state = TRADE_STEP.ITEM;

    // Each copy carries the OTHER side's objid + bag; uidPlayer is the initiator
    // in BOTH copies (DPSrvr.cpp:8871 passes pUser->m_idPlayer twice).
    this.deps.playerManager.sendTo(player,
      buildTrade(target.m_idPlayer, player.m_idPlayer, target.m_Inventory));
    this.deps.playerManager.sendTo(target,
      buildTrade(player.m_idPlayer, player.m_idPlayer, player.m_Inventory));
    logger.info({ a: player.m_idPlayer, b: target.m_idPlayer }, 'trade opened');
    return OK;
  }

  // ── Staging ───────────────────────────────────────────────────────────────

  /**
   * `OnTradePut` (DPSrvr.cpp:8737) + `TradeSetItem2` (`MoverItem.cpp:210`).
   * Stakes `count` from bag `slot` into window `index`. The count is clamped to
   * the slot's live count and echoed back -- the client renders the clamped
   * value, so echoing the requested one desyncs the window.
   */
  put(player: CPlayer, index: number, itemType: number, slot: number, count: number): TradeResult {
    const other = this.partner(player);
    if (!other) return fail('no-partner');
    if (index < 0 || index >= MAX_TRADE) return fail('bad-index');
    if (count < 1) return fail('bad-count');

    // Both sides must still be staging; else TRADEPUTERROR (self only).
    if (player.m_vtInfo.state !== TRADE_STEP.ITEM || other.m_vtInfo.state !== TRADE_STEP.ITEM) {
      this.deps.playerManager.sendTo(player, buildTradePutError(player.m_idPlayer));
      return fail('wrong-step');
    }
    if (player.m_vtInfo.items[index]) return this.refuse(player, TID_GAME_CANNOTTRADE_ITEM);

    const refusal = this.checkStakeable(player, slot);
    if (refusal !== 0) return this.refuse(player, refusal);

    const item = player.m_Inventory[slot]!;
    const staged = Math.min(count, item.count);
    player.m_vtInfo.items[index] = {
      slot, objid: item.objid ?? slot, itemId: item.itemId, count: staged,
    };

    const packet = buildTradePut(player.m_idPlayer, index, itemType, slot, staged);
    this.deps.playerManager.sendTo(player, packet);
    this.deps.playerManager.sendTo(other, packet);
    return OK;
  }

  /** `OnTradePull` (DPSrvr.cpp:8781) -- unstake window `index`. */
  pull(player: CPlayer, index: number): TradeResult {
    const other = this.partner(player);
    if (!other) return fail('no-partner');
    if (index < 0 || index >= MAX_TRADE) return fail('bad-index');
    if (player.m_vtInfo.state !== TRADE_STEP.ITEM || other.m_vtInfo.state !== TRADE_STEP.ITEM) {
      return fail('wrong-step');
    }
    if (!player.m_vtInfo.items[index]) return fail('empty');

    player.m_vtInfo.items[index] = null;
    const packet = buildTradePull(player.m_idPlayer, index);
    this.deps.playerManager.sendTo(player, packet);
    this.deps.playerManager.sendTo(other, packet);
    return OK;
  }

  /**
   * `OnTradePutGold` (DPSrvr.cpp:8807) -- stake gold. **Debits the bag now**
   * (C++ `AddGold( -nGold )`), clamped to what the player actually holds. The
   * refund lives in {@link clearSide}; every abort path must go through it.
   *
   * Note C++ REPLACES the staked amount (`TradeSetGold( nGold )`) rather than
   * adding, but debits only the new amount -- staking twice would silently eat
   * the first stake. We refund the previous stake before applying the new one,
   * which is the same behavior for the normal single-stake flow and stops the
   * double-stake leak.
   */
  putGold(player: CPlayer, amount: number): TradeResult {
    const other = this.partner(player);
    if (!other) return fail('no-partner');
    if (amount <= 0) return fail('bad-amount');
    if (player.m_vtInfo.state !== TRADE_STEP.ITEM || other.m_vtInfo.state !== TRADE_STEP.ITEM) {
      return fail('wrong-step');
    }

    // Refund any prior stake first (see doc note), then debit the clamped amount.
    const available = player.m_nGold + player.m_vtInfo.gold;
    const staked = Math.min(Math.floor(amount), available);
    player.m_nGold = available - staked;
    player.m_vtInfo.gold = staked;
    player._dirty.add('m_nGold');

    this.deps.journal?.append({
      charId: player.m_idPlayer, type: 'CHAR_GOLD', payload: { gold: player.m_nGold },
    });
    void this.deps.inventoryRepo.setGold(player.m_idPlayer, player.m_nGold)
      .catch((err: unknown) => logger.error({ err, charId: player.m_idPlayer }, 'setGold failed'));

    const packet = buildTradePutGold(player.m_idPlayer, staked);
    this.deps.playerManager.sendTo(player, packet);
    this.deps.playerManager.sendTo(other, packet);
    return OK;
  }

  // ── Commit ────────────────────────────────────────────────────────────────

  /**
   * `OnTradeOk` (DPSrvr.cpp:8926) -- press OK. When the partner is already OK,
   * both get TRADELASTCONFIRM instead of a plain OK echo.
   */
  ok(player: CPlayer): TradeResult {
    const other = this.partner(player);
    if (!other) return fail('no-partner');
    if (player.m_vtInfo.state !== TRADE_STEP.ITEM) return fail('wrong-step');

    player.m_vtInfo.state = TRADE_STEP.OK;
    if (other.m_vtInfo.state === TRADE_STEP.OK) {
      const packet = buildTradeLastConfirm();
      this.deps.playerManager.sendTo(player, packet);
      this.deps.playerManager.sendTo(other, packet);
    } else {
      const packet = buildTradeOk(player.m_idPlayer);
      this.deps.playerManager.sendTo(player, packet);
      this.deps.playerManager.sendTo(other, packet);
    }
    return OK;
  }

  /**
   * `OnTradelastConfrim` (DPSrvr.cpp:8877) -- the two-phase commit. First side
   * to confirm moves to CONFIRM and both get LASTCONFIRMOK; when the second
   * confirms and the partner is already at CONFIRM, the swap runs.
   */
  lastConfirm(player: CPlayer): TradeResult {
    const other = this.partner(player);
    if (!other) return fail('no-partner');
    if (player.m_vtInfo.state !== TRADE_STEP.OK) return fail('wrong-step');

    if (other.m_vtInfo.state === TRADE_STEP.OK) {
      player.m_vtInfo.state = TRADE_STEP.CONFIRM;
      const packet = buildTradeLastConfirmOk(player.m_idPlayer);
      this.deps.playerManager.sendTo(player, packet);
      this.deps.playerManager.sendTo(other, packet);
      return OK;
    }
    if (other.m_vtInfo.state !== TRADE_STEP.CONFIRM) return fail('wrong-step');
    return this.commit(player, other);
  }

  /**
   * `CVTInfo::TradeConsent` (`MoverItem.cpp:126`) -- the atomic swap.
   *
   * Plan-then-apply: build BOTH sides' complete slot deltas and verify bag space
   * + gold headroom before mutating anything. Any failure => TRADE_CONFIRM_ERROR,
   * both sides cleared (refunding gold) and TRADECANCEL with objid NULL_ID,
   * exactly as C++ does on `TRADE_CONFIRM_ERROR` (DPSrvr.cpp:8910).
   */
  private commit(a: CPlayer, b: CPlayer): TradeResult {
    const plan = this.planSwap(a, b);
    if (!plan) return this.abortCommit(a, b);

    // --- WAL before any ack (rule 04). Absolute end-state per slot. ---
    for (const side of [plan.a, plan.b]) {
      for (const [slot, content] of side.slots) {
        this.deps.journal?.append({
          charId: side.player.m_idPlayer,
          type: 'INVENTORY_SLOT',
          payload: { slot, itemId: content?.itemId ?? 0, count: content?.count ?? 0 },
        });
      }
      this.deps.journal?.append({
        charId: side.player.m_idPlayer, type: 'CHAR_GOLD', payload: { gold: side.gold },
      });
    }

    // --- Apply. ---
    for (const side of [plan.a, plan.b]) {
      const p = side.player;
      for (const [slot, content] of side.slots) {
        p.m_Inventory[slot] = content;
        if (content) {
          // Preserve instance state (refine/element/durability) across the move --
          // the item keeps its identity, only its owner and slot change.
          void this.deps.inventoryRepo.setItem(
            p.m_idPlayer, slot, content.itemId, content.count,
            content.flags ?? 0, content.durability ?? -1, content.refine ?? 0,
            null, content.element ?? 0, content.element_level ?? 0,
          ).catch((err: unknown) => logger.error({ err }, 'trade setItem failed'));
        } else {
          void this.deps.inventoryRepo.removeItem(p.m_idPlayer, slot)
            .catch((err: unknown) => logger.error({ err }, 'trade removeItem failed'));
        }
      }
      p.m_nGold = side.gold;
      p._dirty.add('m_nGold');
      void this.deps.inventoryRepo.setGold(p.m_idPlayer, p.m_nGold)
        .catch((err: unknown) => logger.error({ err }, 'trade setGold failed'));
    }

    // Gold is already folded into m_nGold, so zero the stakes before clearing --
    // otherwise clear()'s refund path would credit it a second time.
    a.m_vtInfo.gold = 0;
    b.m_vtInfo.gold = 0;
    a.m_vtInfo.clear();
    b.m_vtInfo.clear();

    const packet = buildTradeConsent();
    this.deps.playerManager.sendTo(a, packet);
    this.deps.playerManager.sendTo(b, packet);
    logger.info({ a: a.m_idPlayer, b: b.m_idPlayer }, 'trade committed');
    return OK;
  }

  /**
   * Build the complete two-sided swap plan, or `null` if it cannot be honoured.
   *
   * Order matters: first collect what each side gives up (validating every stake
   * against the live bag), which frees slots; only then place incoming items,
   * allowing a slot vacated by an outgoing item to receive an incoming one. That
   * matches C++, which removes from `m_Inventory` before `Add`ing the partner's
   * goods (`MoverItem.cpp:139-186`).
   */
  private planSwap(a: CPlayer, b: CPlayer): TradeSwapPlan | null {
    const sideA = this.collectOutgoing(a);
    const sideB = this.collectOutgoing(b);
    if (!sideA || !sideB) return null;

    // Cross-place: A receives B's outgoing, and vice versa.
    if (!this.place(a, sideA, sideB.outgoing)) return null;
    if (!this.place(b, sideB, sideA.outgoing)) return null;

    // Gold crosses over; overflow on either side aborts the whole trade.
    const goldA = a.m_nGold + b.m_vtInfo.gold;
    const goldB = b.m_nGold + a.m_vtInfo.gold;
    if (goldA > MAX_GOLD || goldB > MAX_GOLD) return null;

    return {
      a: { ...sideA, gold: goldA },
      b: { ...sideB, gold: goldB },
    };
  }

  /**
   * Validate every stake against the live bag and record the giver's outgoing
   * slot deltas. Returns `null` when a stake no longer matches -- the item was
   * dropped, used, sold or moved since staking (module doc, point 1).
   */
  private collectOutgoing(giver: CPlayer): SidePlan | null {
    const slots = new Map<number, InventorySlot | null>();
    const outgoing: InventorySlot[] = [];

    for (const index of giver.m_vtInfo.occupied()) {
      const stake = giver.m_vtInfo.items[index]!;
      const live = giver.m_Inventory[stake.slot];
      if (!live || live.itemId !== stake.itemId) return null;
      if ((live.objid ?? stake.slot) !== stake.objid) return null;
      if (live.count < stake.count) return null;

      const remaining = live.count - stake.count;
      slots.set(stake.slot, remaining > 0 ? { ...live, count: remaining } : null);
      outgoing.push({ ...live, count: stake.count });
    }
    return { player: giver, slots, outgoing };
  }

  /**
   * Place `incoming` into `receiver`'s bag, writing into the side's own slot map.
   * A slot the receiver is emptying this commit counts as free. Returns false on
   * bag full.
   */
  private place(receiver: CPlayer, side: SidePlan, incoming: readonly InventorySlot[]): boolean {
    for (const item of incoming) {
      const slot = this.findFreeSlot(receiver, side.slots);
      if (slot < 0) return false;
      side.slots.set(slot, { ...item, objid: slot });
    }
    return true;
  }

  /**
   * First bag slot that will be empty once this commit's deltas apply. A slot
   * already assigned in `slots` is taken unless the delta emptied it; a slot the
   * bag holds is taken unless the delta emptied it.
   */
  private findFreeSlot(player: CPlayer, slots: ReadonlyMap<number, InventorySlot | null>): number {
    for (let i = 0; i < MAX_INVENTORY; i++) {
      if (slots.has(i)) {
        if (slots.get(i) === null) return i;      // emptied by this commit
        continue;                                 // already claimed
      }
      if (!player.m_Inventory[i]) return i;
    }
    return -1;
  }

  /** TRADE_CONFIRM_ERROR path (DPSrvr.cpp:8907) -- clear both, cancel both. */
  private abortCommit(a: CPlayer, b: CPlayer): TradeResult {
    this.clearSide(a);
    this.clearSide(b);
    // C++ passes NULL_ID as the objid on this path, unlike an explicit cancel.
    this.deps.playerManager.sendTo(a, buildTradeCancel(NULL_ID, a.m_idPlayer));
    this.deps.playerManager.sendTo(b, buildTradeCancel(NULL_ID, a.m_idPlayer));
    logger.warn({ a: a.m_idPlayer, b: b.m_idPlayer }, 'trade commit aborted');
    return fail('commit-error');
  }

  // ── Teardown ──────────────────────────────────────────────────────────────

  /** `OnTradeCancel` (DPSrvr.cpp:8858) -- explicit cancel from either side. */
  cancel(player: CPlayer, mode = 0): TradeResult {
    const other = this.partner(player);
    this.clearSide(player);
    if (other) this.clearSide(other);

    const packet = buildTradeCancel(player.m_idPlayer, player.m_idPlayer, mode);
    this.deps.playerManager.sendTo(player, packet);
    if (other) this.deps.playerManager.sendTo(other, packet);
    return OK;
  }

  /**
   * Disconnect hook -- `CMover::~CMover` runs `pOther->m_vtInfo.TradeClear()`
   * (`Mover.cpp:187`). Without this the surviving partner stays wedged in a
   * trade forever AND loses any staked gold.
   */
  onDisconnect(player: CPlayer): void {
    const other = this.partner(player);
    this.clearSide(player);
    if (other) {
      this.clearSide(other);
      this.deps.playerManager.sendTo(other,
        buildTradeCancel(player.m_idPlayer, player.m_idPlayer, 0));
    }
  }

  /**
   * `CVTInfo::TradeClear` including the gold refund (`MoverItem.cpp:83`).
   * Refund happens BEFORE the state reset so the staked amount is still readable.
   */
  private clearSide(player: CPlayer): void {
    const refund = player.m_vtInfo.gold;
    if (refund > 0) {
      player.m_nGold = Math.min(MAX_GOLD, player.m_nGold + refund);
      player._dirty.add('m_nGold');
      this.deps.journal?.append({
        charId: player.m_idPlayer, type: 'CHAR_GOLD', payload: { gold: player.m_nGold },
      });
      void this.deps.inventoryRepo.setGold(player.m_idPlayer, player.m_nGold)
        .catch((err: unknown) => logger.error({ err }, 'trade refund setGold failed'));
    }
    player.m_vtInfo.clear();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** The live partner, or `undefined` when idle / partner gone. */
  private partner(player: CPlayer): CPlayer | undefined {
    const id = player.m_vtInfo.otherId;
    if (id === null) return undefined;
    const other = this.deps.playerManager.get(id);
    // Partner vanished (disconnect race): clear our side so we are not wedged.
    if (!other || other.m_vtInfo.otherId !== player.m_idPlayer) {
      this.clearSide(player);
      return undefined;
    }
    return other;
  }

  /**
   * `TradeSetItem2` refusal gates (`MoverItem.cpp:210-236`), in C++ order.
   * Returns the `TID_*` to send, or 0 when stakeable.
   *
   * ponytail: guild-cloak (`m_idGuild != 0`), quest-item and bound-item flags,
   * and the vagrant-ride case need their CItemElem fields; today only the
   * equip-slot, in-use and tradeable-prop gates are modellable.
   */
  private checkStakeable(player: CPlayer, slot: number): number {
    if (slot < 0 || slot >= MAX_INVENTORY) return TID_GAME_CANNOTTRADE_ITEM;
    const item = player.m_Inventory[slot];
    if (!item || item.count <= 0) return TID_GAME_CANNOTTRADE_ITEM;
    // Equip parts live at >= MAX_INVENTORY, so the range check above already
    // covers `IsEquip`; an equipped item can never be in the bag range.
    const prop = this.deps.getItemProp?.(item.itemId);
    if (prop?.tradeable === false) return TID_GAME_CANNOTTRADE_ITEM;
    if (player.m_vtInfo.occupied().some((i) => player.m_vtInfo.items[i]!.slot === slot)) {
      return TID_GAME_CANNOT_DO_USINGITEM;             // already staged
    }
    return 0;
  }

  private refuse(player: CPlayer, tid: number): TradeResult {
    this.deps.sendDefinedText?.(player, tid);
    return fail(`refused:${tid}`);
  }
}

/** `TID_GAME_BATTLE_NOTTRADE` -- target is in combat. */
const TID_GAME_BATTLE_NOTTRADE = 1926;

/**
 * `CMover::IsAttackMode` (`_Common/Mover.cpp:9485`):
 * `m_nAtkCnt && m_nAtkCnt < SEC1 * 10` -- damaged within the last 10 s. We
 * track a wall-clock cursor (`m_tmLastDamage`) as RecoverySystem does.
 */
function isAttackMode(player: CPlayer, now: number): boolean {
  return player.m_tmLastDamage > 0 && now - player.m_tmLastDamage < 10_000;
}

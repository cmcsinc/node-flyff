/**
 * InventoryService — pickup game logic (Phase E core, wire-agnostic).
 *
 * Owns the `DoLoot` → `CInventory::Add` / `PickupGold` mutations
 * (`_Common/MoverActEvent.cpp:2575`). Wire framing (CREATEITEM / DEL_OBJ /
 * SETGOLD snapshots) + the ACTMSG handler live in the pickup path; this service
 * is the pure state mutation so it's testable without a socket.
 *
 * Ordering (rule 03/04 — WAL before ack): validate → journal → mutate →
 * fire-and-forget persist. The handler sends the success snapshot only after a
 * `{ ok: true }` return, so the journal always precedes the client ack.
 *
 * Persists write-through at the source (matches the combat exp/gold cadence —
 * no 30 s flush loop); the WAL row is the crash-recovery source of truth.
 *
 * ponytail: non-stacking — each pickup takes a fresh empty slot. Stack-onto-
 * same-itemId lands when propItem `nMaxStack` is wired (Phase E follow-up).
 *
 * @module services/inventory
 */

import type { InventoryRepository, CharacterRepository, Journal } from '@flyff/database';
import { MAX_GOLD } from '@flyff/core';
import { createLogger } from '@flyff/core/logger.js';
import type { CPlayer } from '../entities/player.js';
import { MAX_INVENTORY } from '../net/snapshot/constants.js';

const logger = createLogger({ module: 'inventory-service' });

export interface InventoryServiceDeps {
  inventoryRepo: Pick<InventoryRepository, 'setItem'>;
  charRepo: Pick<CharacterRepository, 'updateGold'>;
  /** WAL journal — optional so tests can omit it. */
  journal?: Journal;
}

export type AddItemResult =
  | { ok: true; slot: number; itemId: number; count: number }
  | { ok: false; reason: 'bag_full' | 'invalid' };

export class InventoryService {
  constructor(private readonly deps: InventoryServiceDeps) {}

  /**
   * Place `count` of `itemId` into the first empty main-bag slot. Non-stacking
   * (see module ponytail). Returns the slot on success so the handler can build
   * the CREATEITEM snapshot; `bag_full` so it can send `TID_GAME_LACKSPACE`.
   */
  addItem(player: CPlayer, itemId: number, count: number): AddItemResult {
    if (count <= 0) return { ok: false, reason: 'invalid' };
    const slot = this.findEmpty(player);
    if (slot === -1) return { ok: false, reason: 'bag_full' };

    this.deps.journal?.append({
      charId: player.m_idPlayer,
      type: 'INVENTORY_SLOT',
      payload: { slot, itemId, count },
    });
    player.m_Inventory[slot] = { itemId, count };
    player._dirty.add('m_Inventory');

    this.deps.inventoryRepo
      .setItem(player.m_idPlayer, slot, itemId, count)
      .catch((err: unknown) => logger.warn({ err, charId: player.m_idPlayer, slot }, 'inventory setItem failed'));

    return { ok: true, slot, itemId, count };
  }

  /**
   * Credit `amount` penya to `m_nGold`, clamped to `MAX_GOLD` (rule 03 — gold
   * overflow). Journals the ABSOLUTE gold total (`CHAR_GOLD`), fire-and-forget
   * `updateGold`. The WAL row is the idempotent crash-recovery backup.
   */
  addGold(player: CPlayer, amount: number): void {
    if (amount <= 0) return;
    const before = player.m_nGold;
    player.m_nGold = Math.min(MAX_GOLD, before + amount);
    this.deps.journal?.append({
      charId: player.m_idPlayer,
      type: 'CHAR_GOLD',
      payload: { gold: player.m_nGold },
    });
    player._dirty.add('m_nGold');
    this.deps.charRepo
      .updateGold(player.m_idPlayer, player.m_nGold)
      .catch((err: unknown) => logger.warn({ err, charId: player.m_idPlayer }, 'gold persist failed'));
  }

  /** First empty main-bag slot (0..MAX_INVENTORY-1), or -1 if the bag is full. */
  private findEmpty(player: CPlayer): number {
    for (let i = 0; i < MAX_INVENTORY; i++) {
      if (player.m_Inventory[i] === null) return i;
    }
    return -1;
  }
}

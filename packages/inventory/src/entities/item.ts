/**
 * GroundItem -- a dropped `CItem` lying in the world.
 *
 * Mirrors the C++ ground-item fields the client renders (`Item.cpp:459` ctor,
 * `Item.h:968-970`): server-allocated object id, propItem id, stack count,
 * owner (first-hitter loot lock), drop timestamp, placement. Object ids start
 * at `FIRST_ITEM_ID` (0x80000000) -- disjoint from mover (0x40000000) and player
 * (char) ranges so the client never confuses a pile with a mover.
 *
 * C++ field names preserved (`m_idOwn`, `m_dwDropTime`, `m_bDropMob`) for
 * cross-referencing `_Common/Item.cpp` / `MoverActEvent.cpp` (IsLoot/DoLoot).
 *
 * @module entities/item
 */

import type { Vec3 } from '@flyff/entities';

/** First object id for a ground item -- disjoint from movers + players. */
export const FIRST_ITEM_ID = 0x80000000;

export interface GroundItemInit {
  /** propItem id (`II_*` resolved) -> CItemBase.m_dwItemId. */
  readonly itemId: number;
  /** Stack size -> CItemElem.m_nItemNum. */
  readonly count: number;
  /** Looter char id (`m_idOwn`); NULL_ID (0xffffffff) = FFA. */
  readonly ownerId: number;
  readonly pos: Vec3;
  readonly zoneId: number;
  /**
   * `CItem::m_bDropMob` -- TRUE when a monster dropped this pile, FALSE when a
   * player threw it on the ground. `DoLoot` (`MoverActEvent.cpp:2669`) branches
   * on it: mob drops go through `SubLootDropMob` (party item distribution +
   * party gold split), player drops through `SubLootDropNotMob` (always the
   * finder). Defaults FALSE -- a party must never redistribute an item a member
   * dropped for a specific person.
   */
  readonly dropMob?: boolean;
}

export class GroundItem {
  /** Server object id (C++ `m_objid`). */
  readonly m_idObject: number;
  readonly m_dwItemId: number;
  readonly m_nItemNum: number;
  /** Owner char id (first-hitter) or 0xffffffff for FFA. C++ `m_idOwn`. */
  readonly m_idOwn: number;
  /** When dropped (ms) -- drives the 3-min decay (`Item.cpp:515-556`). */
  readonly m_dwDropTime: number;
  readonly m_vPos: Vec3;
  readonly m_nZoneId: number;
  /** `m_bDropMob` -- monster drop (party-distributed) vs player drop. */
  readonly m_bDropMob: boolean;

  private constructor(id: number, init: GroundItemInit, now: number) {
    this.m_idObject = id;
    this.m_dwItemId = init.itemId;
    this.m_nItemNum = init.count;
    this.m_idOwn = init.ownerId;
    this.m_dwDropTime = now;
    this.m_vPos = { ...init.pos };
    this.m_nZoneId = init.zoneId;
    this.m_bDropMob = init.dropMob ?? false;
  }

  /** Allocate a ground item with `id` (caller owns the id counter). */
  static spawn(id: number, init: GroundItemInit, now: number): GroundItem {
    return new GroundItem(id, init, now);
  }
}

/** Flyff NULL_ID -- sentinel for "no owner" (FFA loot). */
export const NULL_ID = 0xffffffff;

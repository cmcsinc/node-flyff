/**
 * ItemManager -- owns live {@link GroundItem}s + their decay timers.
 *
 * `spawn(init)` allocates an objid, registers the pile, broadcasts its ADD_OBJ
 * to the zone, and arms a 3-min decay timer (C++ `CItem::Process`,
 * `Item.cpp:515-556` -> `MIN(3)`). On expiry the pile is removed + DEL_OBJ is
 * broadcast. `remove(id)` (called by the pickup handler) clears the timer so a
 * looted pile never also fires decay. All timers are tracked + cleared on
 * `shutdown()` (rule 05 -- no leaked timers).
 *
 * Manager holds in-memory state only (rule 02); broadcasts go through the
 * injected {@link ZoneManager} + serializer. No DB, no packet parsing.
 *
 * @module managers/item.manager
 */

import type { Vec3 } from '../entities/player.js';
import { GroundItem, FIRST_ITEM_ID, type GroundItemInit } from '../entities/item.js';
import type { ZoneManager } from './zone.manager.js';
import { ItemSnapshotSerializer } from '../net/snapshot/itemSnapshot.serializer.js';
import { VISIBILITY_RADIUS } from '../net/snapshot/constants.js';
import { createLogger } from '@flyff/core/logger.js';

const logger = createLogger({ module: 'item-manager' });

/** Ground-item lifetime -- `CItem::Process` deletes at `MIN(3)` (Item.cpp:550). */
const DECAY_MS = 3 * 60_000;

export interface ItemManagerDeps {
  zoneManager: ZoneManager;
  /** Injector seam for tests; defaults to `Date.now`. */
  now?: () => number;
}

export class ItemManager {
  private readonly items = new Map<number, GroundItem>();
  private readonly timers = new Map<number, NodeJS.Timeout>();
  private nextId = FIRST_ITEM_ID;
  private readonly zone: ZoneManager;
  private readonly serializer = new ItemSnapshotSerializer();
  private readonly now: () => number;

  constructor(deps: ItemManagerDeps) {
    this.zone = deps.zoneManager;
    this.now = deps.now ?? Date.now;
  }

  /** Drop a pile: register, broadcast ADD_OBJ, arm decay. Returns its objid. */
  spawn(init: GroundItemInit): number {
    const id = this.nextId++;
    const item = GroundItem.spawn(id, init, this.now());
    this.items.set(id, item);

    this.broadcast(item.m_vPos, item.m_nZoneId, this.serializer.build([item]));

    const timer = setTimeout(() => this.expire(id), DECAY_MS);
    this.timers.set(id, timer);
    return id;
  }

  /** Loot/expire: remove the pile, clear its timer, broadcast DEL_OBJ. */
  remove(id: number): GroundItem | undefined {
    const item = this.items.get(id);
    if (!item) return undefined;
    const timer = this.timers.get(id);
    if (timer) { clearTimeout(timer); this.timers.delete(id); }
    this.items.delete(id);
    this.broadcast(item.m_vPos, item.m_nZoneId, this.serializer.buildRemove(id));
    return item;
  }

  /** O(1) lookup by object id. */
  get(id: number): GroundItem | undefined {
    return this.items.get(id);
  }

  /** Clear every pile + decay timer (world shutdown). */
  shutdown(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.items.clear();
  }

  /** Decay fired -- the pile timed out. */
  private expire(id: number): void {
    this.timers.delete(id);
    const item = this.items.get(id);
    if (!item) return;
    this.items.delete(id);
    this.broadcast(item.m_vPos, item.m_nZoneId, this.serializer.buildRemove(id));
    logger.debug({ objid: id, itemId: item.m_dwItemId }, 'Ground item decayed');
  }

  private broadcast(pos: Vec3, zoneId: number, buf: Buffer): void {
    this.zone.broadcastAround(pos, zoneId, VISIBILITY_RADIUS, buf);
  }
}

/**
 * EquipService -- equip/unequip slot moves + validation.
 *
 * Ports `CUser::DoUseEquipmentItem` / `CMover::EquipItem` (`_Common/MoverEquip.
 * cpp:2557/2587`) + `CItemContainer::UnEquip` (`Item.h:571`). Equipping an item
 * moves it from main-bag slot `nId` to the equip slot `MAX_INVENTORY + parts`;
 * unequipping reverses into the first empty main-bag slot. Both journal +
 * persist before the handler sends the DOEQUIP snapshot.
 *
 * Stat recompute is implicit -- `playerCombatant` reads the equip slots every
 * swing via `sumEquipStats`, so no cache invalidation (rule 05).
 *
 * ponytail: refine option encoding, jewelry HR/ER, two-handed offhand block,
 * job/level/gender requirement enforcement (level gated below; full set TODO).
 *
 * @module services/equip
 */

import type { InventoryRepository, Journal } from '@flyff/database';
import type { ItemDefinition } from '@flyff/resources';
import { createLogger } from '@flyff/core/logger';
import type { CPlayer, InventorySlot } from '@flyff/entities';
import { MAX_INVENTORY, MAX_HUMAN_PARTS } from '../net/snapshot/constants';

const logger = createLogger({ module: 'equip-service' });
const PARTS_RIDE = 13; // __HACK_1023 ride-speed slot -- reject for now

export interface EquipServiceDeps {
  inventoryRepo: Pick<InventoryRepository, 'setItem' | 'removeItem'>;
  getItem: (itemId: number) => ItemDefinition | undefined;
  journal?: Journal;
}

export type EquipResult =
  | { ok: true; parts: number; itemId: number; invSlot: number; objid: number }
  | { ok: false; reason: 'invalid' | 'not_equippable' | 'bag_full' | 'restricted' };

export type UnequipResult =
  | { ok: true; parts: number; itemId: number; invSlot: number; objid: number }
  | { ok: false; reason: 'invalid' | 'bag_full' | 'not_equipped' };

export class EquipService {
  constructor(private readonly deps: EquipServiceDeps) {}

  /**
   * Equip the item in main-bag `invSlot` into its own `equip_slot`
   * (server-authoritative). `parts` is the client nPart -- advisory only (-1 for
   * double-click/drag-drop); the server always uses the prop's slot so a lagging
   * client claim (e.g. fashion dwParts remap) can't misroute the equip. Swaps the
   * previously-equipped item back into `invSlot` if the slot was occupied.
   */
  equip(player: CPlayer, invSlot: number, parts: number): EquipResult {
    if (!this.inMainBag(invSlot)) return { ok: false, reason: 'invalid' };
    const item = player.m_Inventory[invSlot];
    if (!item) return { ok: false, reason: 'invalid' };
    const prop = this.deps.getItem(item.itemId);
    const equipSlot = prop?.equip_slot;
    if (!equipSlot || equipSlot < 0 || equipSlot >= MAX_HUMAN_PARTS) return { ok: false, reason: 'not_equippable' };
    // The server is authoritative for the destination slot: always the item's own
    // `equip_slot` (propItem dwParts). The client `nPart` is advisory -- it is -1
    // for the normal equip UX (double-click / drag-drop, `SendDoEquip` default
    // arg, DPClient.cpp:9141) and may lag the server's data for fashion items
    // whose raw dwParts was remapped to the fashion window (PARTS_HAT=26 etc.).
    // Treating client nPart as authoritative would reject those equips; the item
    // always lands in its real (server-defined) slot, which is the anti-cheat.
    void parts;
    if (equipSlot === PARTS_RIDE) return { ok: false, reason: 'restricted' };
    if (prop.level_req && player.m_nLevel < prop.level_req) return { ok: false, reason: 'restricted' };

    const equipIdx = MAX_INVENTORY + equipSlot;
    const prev = player.m_Inventory[equipIdx] ?? null;
    // Journal BOTH slots as canonical INVENTORY_SLOT (absolute end-state) so boot
    // recovery replays them. The old non-canonical ITEM_EQUIP type had no
    // replayer, so on crash the source slot's earlier INVENTORY_SLOT buy row
    // replayed and resurrected the bag copy while the equip slot stayed put --
    // item dupe (memory: wal-crash-recovery-absolute-state / bank-gold-persist-
    // both-sides). itemId 0 => slot cleared.
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'INVENTORY_SLOT', payload: { slot: equipIdx, itemId: item.itemId, count: item.count } });
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'INVENTORY_SLOT', payload: { slot: invSlot, itemId: prev?.itemId ?? 0, count: prev?.count ?? 0 } });
    player.m_Inventory[equipIdx] = item;
    player.m_Inventory[invSlot] = prev;
    player._dirty.add('m_Inventory');
    this.persistSlot(player, equipIdx, item);
    if (prev) this.persistSlot(player, invSlot, prev);
    else this.deps.inventoryRepo.removeItem(player.m_idPlayer, invSlot).catch((e: unknown) => logger.warn({ err: e }, 'equip removeItem failed'));
    return { ok: true, parts: equipSlot, itemId: item.itemId, invSlot, objid: item.objid ?? invSlot };
  }

  /** Unequip `parts` back into the first empty main-bag slot. */
  unequip(player: CPlayer, parts: number): UnequipResult {
    if (parts <= 0 || parts >= MAX_HUMAN_PARTS) return { ok: false, reason: 'invalid' };
    const equipIdx = MAX_INVENTORY + parts;
    const item = player.m_Inventory[equipIdx];
    if (!item) return { ok: false, reason: 'not_equipped' };
    const dst = this.findEmpty(player);
    if (dst === -1) return { ok: false, reason: 'bag_full' };

    // Canonical INVENTORY_SLOT for both slots (see equip() note). equip slot
    // cleared, item lands in the first empty bag slot.
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'INVENTORY_SLOT', payload: { slot: equipIdx, itemId: 0, count: 0 } });
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'INVENTORY_SLOT', payload: { slot: dst, itemId: item.itemId, count: item.count } });
    player.m_Inventory[equipIdx] = null;
    player.m_Inventory[dst] = item;
    player._dirty.add('m_Inventory');
    this.deps.inventoryRepo.removeItem(player.m_idPlayer, equipIdx).catch((e: unknown) => logger.warn({ err: e }, 'unequip remove equipSlot failed'));
    this.persistSlot(player, dst, item);
    return { ok: true, parts, itemId: item.itemId, invSlot: dst, objid: item.objid ?? equipIdx };
  }

  private inMainBag(slot: number): boolean {
    return slot >= 0 && slot < MAX_INVENTORY;
  }

  private findEmpty(player: CPlayer): number {
    for (let i = 0; i < MAX_INVENTORY; i++) {
      if (player.m_Inventory[i] === null) return i;
    }
    return -1;
  }

  private persistSlot(player: CPlayer, slot: number, s: InventorySlot): void {
    this.deps.inventoryRepo
      .setItem(player.m_idPlayer, slot, s.itemId, s.count, s.flags ?? 0, s.durability ?? -1, s.refine ?? 0)
      .catch((e: unknown) => logger.warn({ err: e, slot }, 'equip setItem failed'));
  }
}

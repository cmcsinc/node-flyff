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
import { buildSetPointParam, DST_FP, DST_HP, DST_MP, MAX_INVENTORY, MAX_HUMAN_PARTS } from '@flyff/world-core';

const logger = createLogger({ module: 'equip-service' });
const PARTS_RIDE = 13; // __HACK_1023 ride-speed slot -- reject for now

export interface EquipServiceDeps {
  inventoryRepo: Pick<InventoryRepository, 'setItem' | 'removeItem'>;
  getItem: (itemId: number) => ItemDefinition | undefined;
  /** Push a framed packet to the player (clamp-on-unequip vital sync). */
  sendTo: (player: CPlayer, buf: Buffer) => void;
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
    // Track the bag->equip index move (item's m_dwObjId travels to equipIdx on
    // the client; invSlot's m_apIndex becomes a fresh free objid). ponytail:
    // when `prev` exists (swap), the client self-UnEquips it to its own first
    // empty bag slot -- not tracked here; only the primary move is mirrored.
    player.onEquipIndexMove(invSlot, equipIdx);
    player._dirty.add('m_Inventory');
    // Swap DST effects: remove the previously-equipped item's bonuses, apply the
    // new item's. Then clamp current vitals to the new maxes (unequipping +HP
    // gear can lower max below current -- push the clamped value so the client
    // doesn't sit over-max until the next regen tick).
    if (prev) this.applyItemEffects(player, prev.itemId, false);
    this.applyItemEffects(player, item.itemId, true);
    this.clampVitals(player);
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
    // Track the equip->bag index move: on the client m_apIndex[dst] becomes the
    // item's equip-time m_dwObjId (the stale value addItem must reuse if this
    // slot is later refilled). equipIdx's m_apIndex is cleared.
    player.onUnequipIndexMove(equipIdx, dst);
    player._dirty.add('m_Inventory');
    // Remove the item's DST effects BEFORE clamping so the max reflects the loss.
    this.applyItemEffects(player, item.itemId, false);
    this.clampVitals(player);
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

  /**
   * Apply (`add`) or remove an item's DST effects on the wearer's `m_params`
   * (C++ `SetDestParam` per item, `MoverParam.cpp:2221`). Items without
   * `effects` (most weapons/armor whose bonuses are intrinsic ATK/DEF, already
   * folded per-swing by `sumEquipStats`) are a no-op.
   */
  private applyItemEffects(player: CPlayer, itemId: number, add: boolean): void {
    const prop = this.deps.getItem(itemId);
    const effects = prop?.effects;
    if (!effects || effects.length === 0) return;
    if (add) player.m_params.applyEffects(effects);
    else player.m_params.removeEffects(effects);
  }

  /**
   * Refresh the cached `m_nMax*` vitals from the new DST-adjusted maxes after an
   * equip swap, then clamp current HP/MP/FP. Only pushes `SETPOINTPARAM` for a
   * vital when it was clamped DOWN (current exceeded the new max -- e.g.
   * unequipping +HP gear). Rising maxes need no sync; the client recomputes its
   * own displayed max from stats and regen fills upward.
   *
   * The write-back is load-bearing: consumers that read the CACHED `m_nMaxHp`
   * (consumable heal, quest/combat full-heal) would otherwise cap against a
   * stale ceiling until the next recovery tick recomputes it (~3 s window) --
   * e.g. an HP potion after equipping +HP gear filling only to the old max, or a
   * full-heal after unequipping +HP gear refilling over the new max. Mirrors
   * `StatService.applyStatPoints`, which refreshes the same fields on allocate.
   */
  private clampVitals(player: CPlayer): void {
    const maxHp = player.getMaxHp();
    const maxMp = player.getMaxMp();
    const maxFp = player.getMaxFp();
    player.m_nMaxHp = maxHp;
    player.m_nMaxMp = maxMp;
    player.m_nMaxFp = maxFp;
    if (player.m_nHp > maxHp) { player.m_nHp = maxHp; this.deps.sendTo(player, buildSetPointParam(player.m_idPlayer, DST_HP, maxHp)); }
    if (player.m_nMp > maxMp) { player.m_nMp = maxMp; this.deps.sendTo(player, buildSetPointParam(player.m_idPlayer, DST_MP, maxMp)); }
    if (player.m_nFp > maxFp) { player.m_nFp = maxFp; this.deps.sendTo(player, buildSetPointParam(player.m_idPlayer, DST_FP, maxFp)); }
  }
}

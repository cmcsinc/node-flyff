/**
 * EnchantService -- `PACKETTYPE_ENCHANT` (0xf000b024) refine + element logic.
 *
 * Ports the two regular-path branches of `CItemUpgrade` (`WORLDSERVER/
 * ItemUpgrade.cpp`), driven by the *material's* `item_kind3`:
 *   - `IK3_ENCHANT` (Sunstone/orichalcum) -> `EnchantGeneral`: weapon/armor
 *     refine `+1` (`m_nAbilityOption`).
 *   - `IK3_ELECARD` (element card) -> `EnchantAttribute`: set `m_bItemResist`
 *     (element) + bump `m_nResistAbilityOption` (level).
 *
 * Roll = `xRandom(10000) <= chance` (n/10000 tables in {@link upgradeTables}).
 * Failure rule (v19): current level < {@link DESTROY_THRESHOLD} -> item kept,
 * material consumed; >= threshold -> **item destroyed** (no protection buff
 * subsystem yet). Max-level is a pre-check reject (material NOT consumed) so a
 * maxed item can't eat a Sunstone for nothing.
 *
 * Returns a discriminated outcome the handler turns into `UPDATE_ITEM`
 * snapshots (`UI_AO` / `UI_IR` + `UI_RAO` / `UI_NUM=0` on destroy). Element
 * success yields TWO field updates, matching `ItemUpgrade.cpp:1286-1287`.
 *
 * ponytail: catalyst scrolls (+10/+100 %) + protection (SMELPROT) need the buff
 * system -- the regular C++ path consumes those as `BUFF_ITEM`, not inventory
 * slots. Safe-smelt (0x70007000), piercing, SOKCHANG, accessory/collector
 * refine are separate opcodes/paths.
 *
 * @module services/enchant
 */

import type { Journal, InventoryRepository } from '@flyff/database';
import type { ItemDefinition } from '@flyff/resources';
import type { Rng, CPlayer, InventorySlot } from '@flyff/entities';
import { xRandomRng } from '@flyff/entities';
import { MAX_INVENTORY } from '@flyff/world-core';
import { createLogger } from '@flyff/core/logger';
import {
  IK3_ELECARD, IK3_ENCHANT, NO_PROP, MAX_ELEMENT, MAX_REFINE, DESTROY_THRESHOLD,
  CARD_ELEMENT_BY_ID, elementChance, isElementable, isRefinable, refineChance,
} from '../upgrade/upgradeTables';

const logger = createLogger({ module: 'enchant-service' });

export type EnchantRejectReason =
  | 'invalid' | 'equipped' | 'not_refinable' | 'not_elementable'
  | 'wrong_material' | 'element_mismatch' | 'unknown_card';

export type EnchantOutcome =
  | { kind: 'refine_success'; targetSlot: number; newRefine: number; materialSlot: number; materialRemaining: number }
  | { kind: 'element_success'; targetSlot: number; newElement: number; newLevel: number; materialSlot: number; materialRemaining: number }
  | { kind: 'fail_kept'; targetSlot: number; materialSlot: number; materialRemaining: number }
  | { kind: 'fail_destroyed'; targetSlot: number; materialSlot: number; materialRemaining: number }
  | { kind: 'maxed'; targetSlot: number }
  | { kind: 'reject'; reason: EnchantRejectReason };

export interface EnchantServiceDeps {
  inventoryRepo: Pick<InventoryRepository, 'setItem' | 'removeItem'>;
  getItem: (itemId: number) => ItemDefinition | undefined;
  /** Remove `count` from a main-bag slot (scroll/ore consume). Returns post-consume slot or null. */
  consume: (player: CPlayer, slot: number, count?: number) => { count: number } | null;
  journal?: Journal;
  rng?: Rng;
}

export class EnchantService {
  private readonly rng: Rng;
  constructor(private readonly deps: EnchantServiceDeps) {
    this.rng = deps.rng ?? xRandomRng;
  }

  /** Apply one enchant attempt: target item + material (catalyst). */
  enchant(player: CPlayer, targetObjid: number, materialObjid: number): EnchantOutcome {
    const targetSlot = player.findSlotByObjId(targetObjid);
    const materialSlot = player.findSlotByObjId(materialObjid);
    if (targetSlot < 0 || materialSlot < 0 || targetSlot === materialSlot) return { kind: 'reject', reason: 'invalid' };
    // C++ `IsEquip` -> TID_GAME_EQUIPPUT: target must be in the main bag, not worn.
    if (targetSlot >= MAX_INVENTORY) return { kind: 'reject', reason: 'equipped' };

    const target = player.m_Inventory[targetSlot];
    const material = player.m_Inventory[materialSlot];
    if (!target || !material) return { kind: 'reject', reason: 'invalid' };
    const tProp = this.deps.getItem(target.itemId);
    const mProp = this.deps.getItem(material.itemId);
    if (!tProp || !mProp) return { kind: 'reject', reason: 'invalid' };

    const k3 = mProp.item_kind3;
    if (k3 === IK3_ENCHANT) return this.refine(player, targetSlot, materialSlot, tProp);
    if (k3 === IK3_ELECARD) return this.applyElement(player, targetSlot, materialSlot, tProp, material.itemId);
    return { kind: 'reject', reason: 'wrong_material' };
  }

  /** `EnchantGeneral` (ItemUpgrade.cpp:1106): refine +1 on success, destroy on fail >= +3. */
  private refine(player: CPlayer, targetSlot: number, materialSlot: number, tProp: ItemDefinition): EnchantOutcome {
    if (!isRefinable(tProp.item_kind2, tProp.item_kind3)) return { kind: 'reject', reason: 'not_refinable' };
    const target = player.m_Inventory[targetSlot]!;
    const current = target.refine ?? 0;
    if (current >= MAX_REFINE) return { kind: 'maxed', targetSlot };

    const remaining = this.consumeMaterial(player, materialSlot);
    const chance = refineChance(current);
    if (this.rng.int(10000) <= chance) {
      const newRefine = current + 1;
      target.refine = newRefine;
      this.persist(player, targetSlot, target);
      logger.info({ charId: player.m_idPlayer, slot: targetSlot, newRefine }, 'enchant: refine success');
      return { kind: 'refine_success', targetSlot, newRefine, materialSlot, materialRemaining: remaining };
    }
    return this.onFail(player, targetSlot, materialSlot, current, remaining);
  }

  /** `EnchantAttribute` (ItemUpgrade.cpp:1251): element card sets type + bumps level. */
  private applyElement(
    player: CPlayer, targetSlot: number, materialSlot: number, tProp: ItemDefinition, cardId: number,
  ): EnchantOutcome {
    if (!isElementable(tProp.item_kind2, tProp.item_kind3)) return { kind: 'reject', reason: 'not_elementable' };
    const element = CARD_ELEMENT_BY_ID.get(cardId);
    if (element === undefined) return { kind: 'reject', reason: 'unknown_card' };

    const target = player.m_Inventory[targetSlot]!;
    const currentElem = target.element ?? NO_PROP;
    const currentLevel = target.element_level ?? 0;
    // 2nd element rejected (TID_UPGRADE_ERROR_TWOELEMENT, ItemUpgrade.cpp:1138).
    if (currentElem !== NO_PROP && currentElem !== element) return { kind: 'reject', reason: 'element_mismatch' };
    if (currentLevel >= MAX_ELEMENT) return { kind: 'maxed', targetSlot };

    const remaining = this.consumeMaterial(player, materialSlot);
    const chance = elementChance(currentLevel);
    if (this.rng.int(10000) <= chance) {
      const newLevel = currentLevel + 1;
      target.element = element;
      target.element_level = newLevel;
      this.persist(player, targetSlot, target);
      logger.info({ charId: player.m_idPlayer, slot: targetSlot, element, newLevel }, 'enchant: element success');
      return { kind: 'element_success', targetSlot, newElement: element, newLevel, materialSlot, materialRemaining: remaining };
    }
    return this.onFail(player, targetSlot, materialSlot, currentLevel, remaining);
  }

  /** v19 failure: `< DESTROY_THRESHOLD` keeps the item; `>= threshold` destroys it. */
  private onFail(
    player: CPlayer, targetSlot: number, materialSlot: number, level: number, materialRemaining: number,
  ): EnchantOutcome {
    if (level < DESTROY_THRESHOLD) {
      logger.info({ charId: player.m_idPlayer, slot: targetSlot, level }, 'enchant: fail (item kept)');
      return { kind: 'fail_kept', targetSlot, materialSlot, materialRemaining };
    }
    // Destroy: clear slot + journal (itemId 0) + removeItem.
    const target = player.m_Inventory[targetSlot]!;
    this.deps.journal?.append({ charId: player.m_idPlayer, type: 'INVENTORY_SLOT', payload: { slot: targetSlot, itemId: 0, count: 0 } });
    player.m_Inventory[targetSlot] = null;
    player._dirty.add('m_Inventory');
    this.deps.inventoryRepo.removeItem(player.m_idPlayer, targetSlot)
      .catch((e: unknown) => logger.warn({ err: e, slot: targetSlot }, 'enchant destroy removeItem failed'));
    logger.info({ charId: player.m_idPlayer, slot: targetSlot, itemId: target.itemId }, 'enchant: fail (item destroyed)');
    return { kind: 'fail_destroyed', targetSlot, materialSlot, materialRemaining };
  }

  private consumeMaterial(player: CPlayer, materialSlot: number): number {
    return Math.max(0, this.deps.consume(player, materialSlot, 1)?.count ?? 0);
  }

  /** Journal the slot's absolute end-state (refine/element included) + fire-and-forget persist. */
  private persist(player: CPlayer, slot: number, s: InventorySlot): void {
    if (!s) return;
    this.deps.journal?.append({
      charId: player.m_idPlayer, type: 'INVENTORY_SLOT',
      payload: {
        slot, itemId: s.itemId, count: s.count,
        flags: s.flags ?? 0, durability: s.durability ?? -1, refine: s.refine ?? 0,
        element: s.element ?? 0, element_level: s.element_level ?? 0,
      },
    });
    player._dirty.add('m_Inventory');
    this.deps.inventoryRepo
      .setItem(player.m_idPlayer, slot, s.itemId, s.count, s.flags ?? 0, s.durability ?? -1, s.refine ?? 0, undefined, s.element ?? 0, s.element_level ?? 0)
      .catch((e: unknown) => logger.warn({ err: e, slot }, 'enchant setItem failed'));
  }
}

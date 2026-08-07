/**
 * AmmoService -- equipped-arrow gate + burn for ranged attacks.
 *
 * Ports two C++ members:
 *
 * - `CMover::IsBullet` (`_Common/Mover.cpp:8673`) / the `DoAttackRange` player
 *   branch (`_Common/MoverSkill.cpp:3646`), which refuse the shot outright when
 *   `PARTS_BULLET` holds nothing or holds a non-`IK3_ARROW` item, and push
 *   `TID_TIP_NEEDSATTACKITEM` (2608) to the shooter.
 * - `CMover::ArrowDown` (`_Common/Mover.cpp:8720`, `#ifdef __WORLDSERVER`), which
 *   decrements the equipped stack, echoes `UpdateItem(m_dwObjId, UI_NUM, n)` per
 *   step, and when the stack hits zero pulls the next same-item stack out of the
 *   bag (`GetAtItemId`) and auto-re-equips it (`DoEquip` + `AddDoEquip`).
 *
 * Lives here (not in `@flyff/combat`) because it mutates the bag: `@flyff/combat`
 * has no `@flyff/inventory` dependency, so `RangeAttackService` takes this in as
 * an injected structural dep (wired in `compose.ts`).
 *
 * WAL: every touched slot is journaled as canonical ABSOLUTE `INVENTORY_SLOT`
 * end-state (rule 04) before the echo, so a crash mid-burn replays to the same
 * arrow count rather than duping or losing the stack.
 *
 * ponytail: the C++ 100-iteration loop only matters for multi-stack burns
 * (`ArrowDown(n)` with n > one stack); every call site in v19 passes 1, and the
 * auto-re-equip below covers the exhaustion case, so the loop is not unrolled.
 *
 * @module services/ammo
 */

import type { InventoryRepository, Journal } from '@flyff/database';
import type { ItemDefinition } from '@flyff/resources';
import { createLogger } from '@flyff/core/logger';
import type { CPlayer, InventorySlot } from '@flyff/entities';
import { PARTS_BULLET, PARTS_RWEAPON } from '@flyff/entities';
import { MAX_INVENTORY } from '@flyff/world-core';
import { buildUpdateItemCount } from '../net/snapshot/updateItem.serializer';
import { buildDoEquipVicinity } from '../net/snapshot/doEquip.serializer';

const logger = createLogger({ module: 'ammo-service' });

/** `defineText.h:1681` -- shown when a bow has no usable arrow equipped. */
export const TID_TIP_NEEDSATTACKITEM = 2608;
/** `defineText.h:1509` -- the same refusal from a bullet-linked skill. */
export const TID_TIP_NEEDSKILLITEM = 2400;

export interface AmmoServiceDeps {
  inventoryRepo: Pick<InventoryRepository, 'setItem' | 'removeItem'>;
  getItem: (itemId: number) => ItemDefinition | undefined;
  /** Framed push to the shooter (UPDATE_ITEM count echo). */
  sendTo: (player: CPlayer, buf: Buffer) => void;
  /** Framed push to self + vicinity peers (auto-re-equip DOEQUIP). */
  broadcastAround?: (player: CPlayer, buf: Buffer) => void;
  journal?: Journal;
}

export class AmmoService {
  constructor(private readonly deps: AmmoServiceDeps) {}

  /**
   * Is an `IK3_ARROW` stack equipped at `PARTS_BULLET`? The exact
   * `DoAttackRange` gate (`MoverSkill.cpp:3646-3648`): equipped-slot lookup, then
   * `dwItemKind3 != IK3_ARROW` -> refuse. Crossbow bolts do NOT pass: this build
   * does not define `__CROSSBOW`, and the C++ compares against `IK3_ARROW` alone.
   */
  hasArrow(player: CPlayer): boolean {
    const slot = player.m_Inventory[MAX_INVENTORY + PARTS_BULLET];
    if (!slot || slot.count <= 0) return false;
    return this.deps.getItem(slot.itemId)?.item_kind3 === 'IK3_ARROW';
  }

  /**
   * Burn `count` arrows from `PARTS_BULLET` (C++ `ArrowDown`). Echoes the new
   * stack count, and on exhaustion promotes the next same-item bag stack into the
   * ammo slot with a DOEQUIP broadcast. No-op when nothing is equipped.
   */
  arrowDown(player: CPlayer, count = 1): void {
    if (count <= 0) return;
    const equipIdx = MAX_INVENTORY + PARTS_BULLET;
    const slot = player.m_Inventory[equipIdx];
    if (!slot) return;
    const itemId = slot.itemId;
    const left = slot.count - count;

    if (left > 0) {
      slot.count = left;
      this.journalSlot(player, equipIdx, itemId, left);
      this.persist(player, equipIdx, slot);
      player._dirty.add('m_Inventory');
      this.deps.sendTo(player, buildUpdateItemCount(player.m_idPlayer, slot.objid ?? equipIdx, left));
      return;
    }

    // Stack exhausted: clear the ammo slot, echo the zero, then promote the next
    // stack of the SAME item id from the bag (C++ `GetAtItemId` + `DoEquip`).
    this.journalSlot(player, equipIdx, 0, 0);
    player.m_Inventory[equipIdx] = null;
    this.deps.inventoryRepo
      .removeItem(player.m_idPlayer, equipIdx)
      .catch((err: unknown) => logger.warn({ err, charId: player.m_idPlayer }, 'arrow removeItem failed'));
    this.deps.sendTo(player, buildUpdateItemCount(player.m_idPlayer, slot.objid ?? equipIdx, 0));
    player._dirty.add('m_Inventory');
    this.promoteNextStack(player, itemId, equipIdx);
  }

  /** Move the first same-`itemId` bag stack into the ammo slot + broadcast DOEQUIP. */
  private promoteNextStack(player: CPlayer, itemId: number, equipIdx: number): void {
    let src = -1;
    for (let i = 0; i < MAX_INVENTORY; i++) {
      if (player.m_Inventory[i]?.itemId === itemId) { src = i; break; }
    }
    if (src === -1) return;
    const next = player.m_Inventory[src]!;
    this.journalSlot(player, src, 0, 0);
    this.journalSlot(player, equipIdx, next.itemId, next.count);
    player.m_Inventory[src] = null;
    player.m_Inventory[equipIdx] = next;
    player.onEquipIndexMove(src, equipIdx);
    player._dirty.add('m_Inventory');
    this.deps.inventoryRepo
      .removeItem(player.m_idPlayer, src)
      .catch((err: unknown) => logger.warn({ err, charId: player.m_idPlayer, src }, 'arrow re-equip removeItem failed'));
    this.persist(player, equipIdx, next);
    // nId = the slot the client currently holds the item at (the bag slot), per
    // the DOEQUIP contract in `doEquip.serializer.ts:16`.
    this.deps.broadcastAround?.(
      player,
      buildDoEquipVicinity(player.m_idPlayer, next.objid ?? src, true,
        { dwId: next.itemId, nOption: 0, byFlag: 0 }, PARTS_BULLET),
    );
  }

  /**
   * Arrows may only sit in the ammo slot while a bow occupies `PARTS_RWEAPON`
   * (`_Common/MoverEquip.cpp:1712` -- `IsEquipAble` refuses `IK3_ARROW` unless the
   * right hand holds `IK3_BOW`). The `__CROSSBOW` branch above it is compiled out
   * in this build, so `IK3_CROSSARROW` is unrestricted here exactly as in C++.
   * Exposed for `EquipService` to call as a pre-mutation gate.
   */
  isArrowEquipAllowed(player: CPlayer, prop: ItemDefinition): boolean {
    if (prop.item_kind3 !== 'IK3_ARROW') return true;
    const hand = player.m_Inventory[MAX_INVENTORY + PARTS_RWEAPON];
    return !!hand && this.deps.getItem(hand.itemId)?.item_kind3 === 'IK3_BOW';
  }

  private journalSlot(player: CPlayer, slot: number, itemId: number, count: number): void {
    this.deps.journal?.append({
      charId: player.m_idPlayer, type: 'INVENTORY_SLOT', payload: { slot, itemId, count },
    });
  }

  private persist(player: CPlayer, slot: number, s: InventorySlot): void {
    this.deps.inventoryRepo
      .setItem(player.m_idPlayer, slot, s.itemId, s.count, s.flags ?? 0, s.durability ?? -1, s.refine ?? 0)
      .catch((err: unknown) => logger.warn({ err, charId: player.m_idPlayer, slot }, 'arrow setItem failed'));
  }
}

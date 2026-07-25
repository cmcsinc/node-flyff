/**
 * ConsumableService -- potion/food HP/MP/FP restore.
 *
 * Ports `CMover::DoUseItemFood` (`_Common/MoverSkill.cpp:3054`): reads the
 * restore amounts from the item prop (`hp_restore`/`mp_restore`/`fp_restore` =
 * propItem `nAdjParamVal` for `DST_HP/MP/FP`), adds them to the current vitals
 * clamped at max, then consumes one charge via `InventoryService.consume`.
 *
 * Service mutates vitals + consumes; the handler sends SETPOINTPARAM snapshots
 * for the changed pools (rule 02 -- no socket writes here).
 *
 * ponytail: over-cap 30 % heal rule (DoUseItemFood:3091), buff-grant items,
 * skill-scroll activation, food SFX.
 *
 * @module services/consumable
 */

import type { ItemDefinition } from '@flyff/resources';
import type { CPlayer, InventorySlot } from '@flyff/entities';
import type { InventoryService } from './inventory.service';

export interface ConsumableResult {
  hp?: number;
  mp?: number;
  fp?: number;
  consumed: InventorySlot | null;
}

export class ConsumableService {
  constructor(private readonly inventory: InventoryService) {}

  /** Restore vitals from `prop` and consume one charge from `slot`. */
  apply(player: CPlayer, prop: ItemDefinition, slot: number): ConsumableResult {
    // Clamp against the formula-derived BUFFED max (C++ `DoUseItemFood:3077`
    // calls `GetMaxPoint` -> `GetMaxHitPoint`, which folds DST_HP_MAX flat +
    // DST_HP_MAX_RATE % from gear/buffs). The cached `m_nMaxHp` field goes stale
    // between recovery ticks and omits equip bonuses, so a +STA/+HP_MAX set
    // (e.g. leaf armor) caps heal at the bare origin value, not the real max.
    // Sync the field so other readers (join/snapshot) see the lifted ceiling.
    const maxHp = player.getMaxHp();
    const maxMp = player.getMaxMp();
    const maxFp = player.getMaxFp();
    player.m_nMaxHp = maxHp;
    player.m_nMaxMp = maxMp;
    player.m_nMaxFp = maxFp;

    const res: ConsumableResult = { consumed: null };
    if (prop.hp_restore && prop.hp_restore > 0) {
      player.m_nHp = Math.min(maxHp, player.m_nHp + prop.hp_restore);
      res.hp = player.m_nHp;
      player._dirty.add('m_nHp');
    }
    if (prop.mp_restore && prop.mp_restore > 0) {
      player.m_nMp = Math.min(maxMp, player.m_nMp + prop.mp_restore);
      res.mp = player.m_nMp;
      player._dirty.add('m_nMp');
    }
    if (prop.fp_restore && prop.fp_restore > 0) {
      player.m_nFp = Math.min(maxFp, player.m_nFp + prop.fp_restore);
      res.fp = player.m_nFp;
      player._dirty.add('m_nFp');
    }
    res.consumed = this.inventory.consume(player, slot, 1);
    return res;
  }
}

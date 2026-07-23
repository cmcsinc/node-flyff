/**
 * DropService -- rolls a dead mover's drop table + spawns ground piles.
 *
 * Ports `CMover::DropItem` (`Mover.cpp:7260`, loop `7707-7851`):
 *   - looter = first-hitter (top of `m_idEnemies`) or the killer fallback;
 *   - level-diff gate: d = killer.level - mover.level buckets
 *     {<=1:1.0, <=2:0.8, <=4:0.6, <=7:0.3, else 0.1};
 *   - per `DropItem` slot: `rng.int(probScale) < prob` -> spawn a pile;
 *   - gold (`DROPTYPE_SEED`): a single pile within `[min..max]`.
 *
 * Server-authoritative + Rng-injected (rule 03 / testable). Drops are NOT
 * WAL-journaled -- a pile is not owned until pickup; the journal happens there.
 *
 * ponytail: QuestItem / DropKind, party loot-share, RANK_SUPER FFA, flying-mob
 * direct-createItem. v1 = ground drops only, owner = first-hitter.
 *
 * @module services/drop
 */

import type { ResourceIndex } from '@flyff/resources';
import type { CPlayer } from '@flyff/entities';
import type { CMover } from '@flyff/entities';
import type { ItemManager } from '../managers/item.manager';
import type { Rng } from '@flyff/combat';
import { NULL_ID } from '../entities/item';

export interface DropServiceDeps {
  resources: Pick<ResourceIndex, 'drops'>;
  itemManager: ItemManager;
  rng?: Rng;
}

/** `xRandom(scale)` analogue -- `[0, scale)`. Reuses the combat `Rng` shape. */
function dropRoll(rng: Rng, scale: number): number {
  return rng.int(scale);
}

/** C++ level-diff factor (Mover.cpp:7728-7733). */
export function dropLevelFactor(killerLevel: number, moverLevel: number): number {
  const d = killerLevel - moverLevel;
  if (d <= 1) return 1.0;
  if (d <= 2) return 0.8;
  if (d <= 4) return 0.6;
  if (d <= 7) return 0.3;
  return 0.1;
}

export class DropService {
  private readonly rng: Rng;
  constructor(private readonly deps: DropServiceDeps) {
    this.rng = deps.rng ?? {
      int: (max) => Math.floor(Math.random() * max),
      range: (a, b) => a + Math.floor(Math.random() * (b - a)),
    };
  }

  /**
   * Roll the dead `mover`'s table for `killer` + spawn the resulting piles.
   * Returns the spawned object ids (gold pile last, if any).
   */
  roll(mover: CMover, killer: CPlayer): number[] {
    const table = this.deps.resources.drops.drops.get(mover.m_dwIndex);
    const looter = this.looter(mover, killer);
    const spawned: number[] = [];
    if (!table) return spawned;

    const scale = this.deps.resources.drops.probScale;
    const factor = dropLevelFactor(killer.m_nLevel, mover.m_nLevel);

    let dropped = 0;
    for (const slot of table.items) {
      if (table.maxItem > 0 && dropped >= table.maxItem) break;
      // C++ gates by fItemDropRate too; we treat factor as the combined gate.
      if (dropRoll(this.rng, scale) < slot.prob * factor) {
        const id = this.deps.itemManager.spawn({
          itemId: slot.itemId,
          count: slot.count,
          ownerId: looter,
          pos: mover.m_vPos,
          zoneId: mover.m_nZoneId,
        });
        spawned.push(id);
        dropped++;
      }
    }

    // Gold pile -- single, only if the table defines a range.
    if (table.gold && table.maxItem > dropped) {
      const gold = this.goldAmount(table.gold.min, table.gold.max);
      if (gold > 0) {
        const id = this.deps.itemManager.spawn({
          itemId: goldSeedId(gold),
          count: gold,
          ownerId: looter,
          pos: mover.m_vPos,
          zoneId: mover.m_nZoneId,
        });
        spawned.push(id);
      }
    }
    return spawned;
  }

  /** First-hitter (max cumulative damage) or killer; NULL_ID if neither. */
  private looter(mover: CMover, killer: CPlayer): number {
    let topId = -1;
    let topDmg = -1;
    for (const [id, dmg] of mover.m_idEnemies) {
      if (dmg > topDmg) { topDmg = dmg; topId = id; }
    }
    return topId >= 0 ? topId : killer.m_idPlayer;
  }

  /** `[min..max]` inclusive penya amount (the C++ DropGold range). */
  private goldAmount(min: number, max: number): number {
    if (max <= min) return min;
    return this.rng.range(min, max + 1);
  }
}

/**
 * Gold-pile propItem ids -- `II_GOLD_SEED1..4` (defineItem.h:26-29). The v15
 * client renders ground penya as one of four seed items chosen by amount.
 */
const II_GOLD_SEED1 = 12;
const II_GOLD_SEED2 = 13;
const II_GOLD_SEED3 = 14;
const II_GOLD_SEED4 = 15;

/**
 * Pick the gold-pile propItem id by amount tier. Ports `CMover::DropItem`
 * (Mover.cpp:7883-7890), which selects the seed via each propItem's
 * `dwAbilityMax` (20 / 50 / 100 / 1000). A pile with `m_dwItemId == 0`
 * null-derefs `GetProp()` in `CItemBase::SetTexture` -> client crash on kill.
 */
export function goldSeedId(amount: number): number {
  if (amount <= 20) return II_GOLD_SEED1;
  if (amount <= 50) return II_GOLD_SEED2;
  if (amount <= 100) return II_GOLD_SEED3;
  return II_GOLD_SEED4;
}

/** True if `itemId` is a gold-pile seed (`II_GOLD_SEED1..4`). Used by the pickup handler to route gold vs item loot. */
export function isGoldSeed(itemId: number): boolean {
  return itemId === II_GOLD_SEED1 || itemId === II_GOLD_SEED2 || itemId === II_GOLD_SEED3 || itemId === II_GOLD_SEED4;
}

void NULL_ID;

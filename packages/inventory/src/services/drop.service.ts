/**
 * DropService -- rolls a dead mover's drop table + spawns ground piles.
 *
 * Ports `CMover::DropItem` (`Mover.cpp:7472`, slot loop `7956-8150`) and
 * `CDropItemGenerator::GetAt` (`Project.cpp:175-211`). The pipeline, in order:
 *
 *   1. looter = first-hitter (top of `m_idEnemies`) or the killer fallback;
 *   2. **outer gate** (`Mover.cpp:7948`): `xRandom(100) < levelBucket * rate`.
 *      One roll for the whole kill. On a miss NOTHING drops, gold included --
 *      the DROPTYPE_SEED branch sits inside the same `if`;
 *   3. per slot: `chance%` hit test, capped by `maxItem` (items only);
 *   4. gold: a single pile in `[min..max]`, scaled by `goldRate`.
 *
 * ## Two divergences from the C++, both deliberate
 *
 * **The roll is unbiased.** The C++ `xRandom(3e9)` is `xRand() % 3e9` over a
 * 32-bit LCG, and 2^32 = 3e9 + 1,294,967,296, so every residue below that band
 * fires twice as often as one above. Every shipped probability is in the doubled
 * band, making every drop ~1.3968x its nominal rate. Rather than port the bug,
 * `chance` in `drops.yml` is pre-calibrated to the rate the C++ *actually*
 * produced (`scripts/converters/drops.ts` -> `calibratePct`) and rolled cleanly
 * here. Live rates are unchanged; the number is finally readable.
 *
 * **The level bucket gates once, not per slot.** This matches the C++ (`nProbability`
 * feeds one `xRandom(100)` before the loop) but NOT the emulator's previous
 * behaviour, which multiplied every slot's prob by the factor -- a second,
 * compounding nerf the original never had.
 *
 * Server-authoritative + Rng-injected (rule 03 / testable). Drops are NOT
 * WAL-journaled -- a pile is not owned until pickup; the journal happens there.
 *
 * ponytail: QuestItem / DropKind, party loot-share, RANK_SUPER FFA, flying-mob
 * direct-createItem, `nloop` giftbox multi-pass, `SetAbilityOption` (the
 * `enchant` field is carried in the data but ItemManager has no enchant slot
 * yet). v1 = ground drops only, owner = first-hitter.
 *
 * @module services/drop
 */

import type { ResourceIndex } from '@flyff/resources';
import type { CPlayer } from '@flyff/entities';
import type { CMover } from '@flyff/entities';
import type { ItemManager } from '../managers/item.manager';
import type { Rng } from '@flyff/entities';
import { NULL_ID } from '../entities/item';

/** Server-wide rate multipliers, from `config/world-server.json` -> `sim`. */
export interface DropRates {
  /**
   * Item drop-rate multiplier -- the `prj.m_fItemDropRate` analogue
   * (`MoverParam.cpp:4252`). 2.0 = a x2 drop event. Multiplied by the table's
   * own `dropRate` when it has one (`GetProp()->m_fItemDrop_Rate`).
   */
  dropRate: number;
  /** Penya multiplier -- `prj.m_fGoldDropRate` (`Mover.cpp:8078`). */
  goldRate: number;
}

export interface DropServiceDeps {
  resources: Pick<ResourceIndex, 'drops'>;
  itemManager: ItemManager;
  rng?: Rng;
  /**
   * Rate multipliers, read fresh on every roll so a GM rate change takes effect
   * without a restart. A function, not a value, for exactly that reason.
   * Defaults to 1.0/1.0 when omitted.
   */
  rates?: () => DropRates;
  /**
   * Quest-collection seam -- true if `killer` has an active quest whose
   * `SetEndCondItem` targets `itemId` and is not yet satisfied. When true the
   * slot bypasses the level-difference gate (C++ `CDropItemGenerator::GetAt`,
   * `Project.cpp:189`, has no level term; the gate is an emulator addition that
   * made quest pieces unfarmable once you out-level the mob).
   * Structural type -- `compose.ts` binds `QuestTrackerSystem.needsItem`, so
   * `@flyff/inventory` keeps no `@flyff/quest` import.
   */
  needsItem?: (killer: CPlayer, itemId: number) => boolean;
}

/** Resolution of the percent roll -- 1e-7 % is the schema's floor for `chance`. */
const PCT_RESOLUTION = 1_000_000_000;

/**
 * Ground Y for a pile dropped by `mover`, killed by `killer`.
 *
 * The client only applies its gravity/ground-snap to a new pile when the
 * server-sent Y is within 1.0 of terrain (`CDPClient::OnAddObj`,
 * `DPClient.cpp:1430`); outside that window the item hangs in the air forever
 * and is unlootable. The C++ server's `GetPos().y` is accurate because it loads
 * the `.lnd` heightmap; we don't, so a monster's `m_vPos.y` stays frozen at its
 * spawn-point Y while it wanders across elevation.
 *
 * ponytail: terrain proxy -- the killer's Y is client-reported and therefore on
 * the ground. Replace with `world.getLandHeight(x, z)` once `.lnd` heightmaps
 * are loaded server-side (then mover Y is authoritative and this can go away).
 */
function groundY(mover: CMover, killer: CPlayer): number {
  return Number.isFinite(killer.m_vPos.y) ? killer.m_vPos.y : mover.m_vPos.y;
}

/**
 * Level-difference gate as a percent, 0-100 (`Mover.cpp:7940-7946`).
 *
 * Note the C++ does not clamp negative `d`, so an under-levelled killer falls in
 * the `d <= 1` bucket at 100 -- faithful here.
 */
export function dropLevelChance(killerLevel: number, moverLevel: number): number {
  const d = killerLevel - moverLevel;
  if (d <= 1) return 100;
  if (d <= 2) return 80;
  if (d <= 4) return 60;
  if (d <= 7) return 30;
  return 10;
}

/** Penya bucket for the same level difference (`nPenyaRate`, same lines). */
export function goldLevelRate(killerLevel: number, moverLevel: number): number {
  const d = killerLevel - moverLevel;
  if (d <= 2) return 100;
  if (d <= 4) return 80;
  if (d <= 7) return 65;
  return 50;
}

/** Retained for the old name; `dropLevelChance` / 100. */
export function dropLevelFactor(killerLevel: number, moverLevel: number): number {
  return dropLevelChance(killerLevel, moverLevel) / 100;
}

export class DropService {
  private readonly rng: Rng;
  constructor(private readonly deps: DropServiceDeps) {
    this.rng = deps.rng ?? {
      int: (max) => Math.floor(Math.random() * max),
      range: (a, b) => a + Math.floor(Math.random() * (b - a)),
    };
  }

  /** `chance` percent hit test, unbiased. `chance >= 100` always hits. */
  private hits(chancePct: number): boolean {
    if (chancePct >= 100) return true;
    if (chancePct <= 0) return false;
    return this.rng.int(PCT_RESOLUTION) < chancePct * (PCT_RESOLUTION / 100);
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

    const rates = this.deps.rates?.() ?? { dropRate: 1, goldRate: 1 };
    // Global rate x this mover's own multiplier -- prj.m_fItemDropRate *
    // GetProp()->m_fItemDrop_Rate (MoverParam.cpp:4252-4254).
    const rate = rates.dropRate * (table.dropRate ?? 1);
    const levelChance = dropLevelChance(killer.m_nLevel, mover.m_nLevel);

    // ONE gate for the whole kill, not per slot (Mover.cpp:7948). A quest
    // collector bypasses it -- otherwise out-levelling the mob makes the piece
    // unfarmable, which the C++ regular-drop roll never does.
    const wantsAnything = table.items.some((s) => this.deps.needsItem?.(killer, s.itemId));
    const gateOpen = wantsAnything || this.hits(levelChance * rate);
    if (!gateOpen) return spawned;

    // Pile Y must be ground-level or the client never snaps it down -> unlootable.
    const dropPos = { x: mover.m_vPos.x, y: groundY(mover, killer), z: mover.m_vPos.z };

    let dropped = 0;
    for (const slot of table.items) {
      // `maxItem` caps items only; gold is counted separately (Mover.cpp:8046).
      if (table.maxItem > 0 && dropped >= table.maxItem) break;
      if (!this.hits(slot.chance * rate)) continue;
      const id = this.deps.itemManager.spawn({
        itemId: slot.itemId,
        // `count` is a maximum: the C++ rolls xRandom(dwNumber) + 1
        // (Mover.cpp:7970), so a `count: 10` slot yields a uniform 1..10.
        count: slot.count > 1 ? this.rng.range(1, slot.count + 1) : 1,
        ownerId: looter,
        pos: dropPos,
        zoneId: mover.m_nZoneId,
      });
      spawned.push(id);
      dropped++;
    }

    // Gold pile -- single, only if the table defines a range. Its own level
    // bucket and rate, and it does not consume a `maxItem` slot.
    if (table.gold) {
      const scale = (goldLevelRate(killer.m_nLevel, mover.m_nLevel) / 100) * rates.goldRate;
      const gold = Math.floor(this.goldAmount(table.gold.min, table.gold.max) * scale);
      if (gold > 0) {
        const id = this.deps.itemManager.spawn({
          itemId: goldSeedId(gold),
          count: gold,
          ownerId: looter,
          pos: dropPos,
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
 * Gold-pile propItem ids -- `II_GOLD_SEED1..4` (defineItem.h:26-29). The v19
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

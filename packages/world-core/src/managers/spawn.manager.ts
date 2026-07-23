/**
 * SpawnManager -- materializes zone spawns into live {@link CMover}s at boot.
 *
 * Reads each loaded zone's `npcs` list (static human/quest NPCs) and `spawns`
 * list (monster spawn points with `count`), resolves the mover definition from
 * the resource index, and instantiates one {@link CMover} per placement --
 * carrying the NPC `outfit` (character.inc SetFigure/SetEquip) through to the
 * wire serializer so equipped NPCs render with gear.
 *
 * Wire objids start at `FIRST_MOVER_ID` (0x40000000) -- high-bit range,
 * disjoint from player char ids so the client never confuses NPC and player
 * objids (memory: v15-npc-addobj-method-exclude-item).
 *
 * Respawn: on `kill(id)`, if the mover's spawn `delay > 0` (monsters only), a
 * `setTimeout` re-materializes it at the same placement after `delay` ms and
 * fires `onSpawn(mover)` so the compose root can broadcast its ADD_OBJ to the
 * zone. Static NPCs pass `delay=0` and never respawn (they don't die anyway).
 * Timers are tracked and cleared on `shutdown()` (rule 05 -- no leaked timers).
 *
 * No tick loop, no AI here (rule 05 -- Systems do per-tick work; the AI system
 * is blocked, see PROGRESS.md). Pure in-memory state + per-respawn timer.
 *
 * @module managers/spawn.manager
 */

import type { ResourceIndex } from '@flyff/resources';
import { blockForMover, type CharacterIncBlock } from '@flyff/resources';
import type { Vec3, InventorySlot } from '@flyff/entities';
import { CMover, type MoverSpawnSource, type MoverOutfit, type VendorStock, EMPTY_VENDOR_STOCK } from '@flyff/entities';
import { createLogger } from '@flyff/core/logger';

const logger = createLogger({ module: 'spawn-manager' });

/** First object id assigned to a non-player mover (player char ids stay below). */
const FIRST_MOVER_ID = 0x40000000;

/** Cap on monsters materialized per spawn point -- bounds memory on bad data. */
const MAX_PER_SPAWN = 50;

/** Per-tab slot cap -- `MAX_VENDOR_INVENTORY` (`ProjectCmn.h:21`, 100). */
const VENDOR_TAB_SLOTS = 100;

/** Everything needed to re-materialize a mover on respawn. */
interface SpawnDesc {
  readonly src: MoverSpawnSource;
  readonly pos: Vec3;
  readonly angle: number;
  readonly zoneId: number;
  /** 0 = never respawn (static NPC). */
  readonly delayMs: number;
}

export interface SpawnManagerDeps {
  resources: ResourceIndex;
  /**
   * Fired when a respawn completes (new mover live in the table). The compose
   * root wires this to broadcast a single-mover ADD_OBJ to the zone so players
   * already present see the monster reappear. Not fired for the boot batch.
   */
  onSpawn?: (mover: CMover) => void;
}

export class SpawnManager {
  private readonly movers = new Map<number, CMover>();
  /** objid -> respawn descriptor, so `kill` can schedule a replacement. */
  private readonly descs = new Map<number, SpawnDesc>();
  /** Live respawn timers -- cleared on `shutdown()` (rule 05). */
  private readonly timers = new Set<NodeJS.Timeout>();
  private nextId = FIRST_MOVER_ID;
  private readonly resources: ResourceIndex;
  private readonly onSpawn: ((mover: CMover) => void) | undefined;

  constructor(deps: SpawnManagerDeps) {
    this.resources = deps.resources;
    this.onSpawn = deps.onSpawn;
  }

  /** Instantiate every zone NPC + monster spawn once, at boot. */
  bootstrap(): void {
    const { zones, movers } = this.resources;
    for (const zone of zones.zones.values()) {
      // Static NPCs (shopkeepers, quest NPCs) -- carry outfit if defined.
      for (const npcSpawn of zone.npcs) {
        const def = movers.movers.get(npcSpawn.mover_id);
        if (!def) {
          logger.warn({ moverId: npcSpawn.mover_id, zone: zone._id }, 'NPC mover def missing -- skipping');
          continue;
        }
        // An NPC placement that resolves to a monster-type mover is a quest/event
        // NPC reusing a monster model (e.g. MaFl_Demian, modeled on MI_DEMIAN1).
        // Without a peaceful NPC overlay it would materialize as an attackable
        // monster standing in town -- skip it until the overlay exists.
        if (def.type === 'monster') {
          logger.warn({ moverId: npcSpawn.mover_id, zone: zone._id }, 'NPC placement resolves to monster-type mover -- skipping');
          continue;
        }
        // Resolve the character.inc block by the placement's character_key when
        // present -- multiple NPCs can share one mover model (e.g. Boboku /
        // Boboko / Bobochan all MI 211) yet have distinct shop stock, dialog,
        // and menus. C++ CMover::GetCharacter looks up by m_szCharacterKey, not
        // by model. Fall back to the mover MI key for placements the .dyo did
        // not tag with a character_key.
        const charBlock = (npcSpawn.character_key
          && this.resources.characterInc.byKey.get(npcSpawn.character_key))
          || blockForMover(this.resources.characterInc, def.key);
        this.materialize({
          src: {
            modelIndex: def.dwObjIndex,
            key: def.key,
            characterKey: charBlock?.key,
            name: def.name,
            level: def.level,
            hp: def.hp,
            scale: def.scale,
            outfit: toOutfit(def, charBlock),
            menus: charBlock?.menus,
            vendorStock: resolveVendorStock(charBlock, this.resources.items),
            attackable: def.attackable,
            guard: def.guard ?? false,
            belligerence: def.belligerence ?? 0,
            atkMin: def.attack,
            atkMax: def.attack,
            armor: def.defense,
            hr: def.attack_rate,
            er: def.dodge_rate,
            expValue: def.exp ?? 0,
            speed: def.speed,
            attackRange: def.attack_range,
            reAttackDelay: def.attack_speed,
          },
          pos: npcSpawn.position, angle: npcSpawn.angle, zoneId: zone._id_numeric,
          delayMs: 0, // static NPC -- never respawns
        });
      }

      // Monster spawn points -- `count` instances around `position`.
      for (const spawn of zone.spawns) {
        const def = movers.movers.get(spawn.mover_id);
        if (!def) {
          logger.warn({ moverId: spawn.mover_id, zone: zone._id }, 'Monster mover def missing -- skipping');
          continue;
        }
        const count = Math.min(MAX_PER_SPAWN, spawn.count);
        for (let i = 0; i < count; i++) {
          this.materialize({
            src: {
              modelIndex: def.dwObjIndex,
              name: def.name,
              level: def.level,
              hp: def.hp,
              scale: def.scale,
              attackable: def.attackable,
              guard: def.guard ?? false,
              belligerence: def.belligerence ?? 0,
              atkMin: def.attack,
              atkMax: def.attack,
              armor: def.defense,
              hr: def.attack_rate,
              er: def.dodge_rate,
              expValue: def.exp ?? 0,
              speed: def.speed,
              attackRange: def.attack_range,
              reAttackDelay: def.attack_speed,
            },
            pos: jitter(spawn.position, spawn.radius, i, count), angle: 0, zoneId: zone._id_numeric,
            delayMs: spawn.delay, // ms until respawn after kill
          });
        }
      }
    }
    logger.info({ count: this.movers.size }, 'Movers spawned');
  }

  /** Create + register a mover from a respawn descriptor. */
  private materialize(desc: SpawnDesc): CMover {
    const id = this.nextId++;
    const mover = CMover.spawn(id, desc.src, desc.pos, desc.zoneId);
    mover.m_fAngle = desc.angle;
    this.movers.set(id, mover);
    this.descs.set(id, desc);
    return mover;
  }

  /** O(1) lookup by object id. */
  get(id: number): CMover | undefined {
    return this.movers.get(id);
  }

  /**
   * Remove a dead mover from the live table. C++ NPC fast-path: `OnDied` calls
   * `Delete()` immediately -- no corpse, no death animation state on the server.
   * If the mover carries a respawn `delay > 0`, schedule a replacement at the
   * same placement; otherwise it is gone for good (static NPC).
   */
  kill(id: number): boolean {
    const desc = this.descs.get(id);
    const had = this.movers.delete(id);
    this.descs.delete(id);
    if (desc && desc.delayMs > 0) {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.respawn(desc);
      }, desc.delayMs);
      this.timers.add(timer);
    }
    return had;
  }

  /** Re-materialize a descriptor and notify the compose root to broadcast it. */
  private respawn(desc: SpawnDesc): void {
    const mover = this.materialize(desc);
    this.onSpawn?.(mover);
  }

  /** Clear every pending respawn timer (called on world shutdown). */
  shutdown(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  /** Find a placed NPC by `character.inc` key (QUESTHELPER_REQNPCPOS target). */
  findByCharacterKey(key: string): CMover | undefined {
    for (const m of this.movers.values()) {
      if (m.outfit?.characterKey === key) return m;
    }
    return undefined;
  }

  /** Iterate every live mover (ambient systems, boot-time scans). */
  *all(): IterableIterator<CMover> {
    yield* this.movers.values();
  }

  /** All live movers in `zoneId` (zone-scoped join snapshot / broadcast). */
  inZone(zoneId: number): CMover[] {
    const out: CMover[] = [];
    for (const m of this.movers.values()) {
      if (m.m_nZoneId === zoneId) out.push(m);
    }
    return out;
  }

  /** Current live mover count. */
  get size(): number {
    return this.movers.size;
  }
}

/**
 * Map a validated mover definition's outfit block to the entity outfit shape.
 * Prefers a parsed character.inc outfit (canonical source) when present; falls
 * back to the mover-yml `outfit` field (test fixtures, hand-authored data).
 */
function toOutfit(
  def: {
    outfit?: {
      characterKey: string;
      hairMesh: number;
      hairColor: number;
      headMesh: number;
      equip: ReadonlyArray<{ parts: number; itemId: number }>;
    } | undefined;
  },
  charBlock: CharacterIncBlock | undefined,
): MoverOutfit | undefined {
  const o = charBlock?.outfit ?? def.outfit;
  if (!o) return undefined;
  return {
    characterKey: o.characterKey,
    hairMesh: o.hairMesh,
    hairColor: o.hairColor,
    headMesh: o.headMesh,
    equip: o.equip.map((e) => ({ parts: e.parts, itemId: e.itemId })),
  };
}

/**
 * Resolve a character.inc vendor block into 4 tabs of concrete stock.
 *
 * `AddVendorItem(slot, IK3_*, job, minU, maxU, totalNum)` expands to the items
 * tagged with that IK3 symbol in {@link ItemIndex.byKind3}, sorted by
 * `level_req` ascending and capped at `totalNum`. `AddVendorItem2(slot, dwId)`
 * appends the explicit propItem id directly. Each placed slot is `{ count: 1 }`
 * -- NPC shops are infinite; per-slot stack counts arrive with BUYITEM/SELLITEM.
 *
 * ponytail: permissive expansion -- the `job`/`nUniqueMin`/`nUniqueMax` band is
 * NOT filtered today (level_req 15-27 would wrongly exclude vagrant-tier stock).
 * Restore the band + sex filter once the C++ expansion in `_Common/Project.cpp`
 * (`AddVendorItem` -> `m_venderItemAry`) is confirmed.
 */
function resolveVendorStock(
  charBlock: CharacterIncBlock | undefined,
  items: ResourceIndex['items'],
): VendorStock {
  if (!charBlock || (charBlock.vendorItems.length === 0 && charBlock.vendorItemIds.length === 0)) {
    return EMPTY_VENDOR_STOCK;
  }
  // Tabs start empty; items are pushed then each row is padded to the slot cap
  // with nulls so every tab is exactly MAX_VENDOR_INVENTORY wide.
  const tabs: (InventorySlot | null)[][] = Array.from({ length: 4 }, () => []);
  const place = (tab: number, itemId: number): void => {
    if (tab < 0 || tab >= tabs.length) return;
    const row = tabs[tab]!;
    if (row.length >= VENDOR_TAB_SLOTS) return;
    row.push({ itemId, count: 1 });
  };

  for (const v of charBlock.vendorItems) {
    if (!v.itemKind3Symbol) continue;
    const matches = items.byKind3.get(v.itemKind3Symbol) ?? [];
    // Whitelist by defineItem.h II_* ids: the client resolves item ids via raw
    // m_aPropItem[id] array lookup, so any id that is not a defined II_* value
    // is a null hole -> SetTexture null-deref crash (Mover.cpp:4591 dwShopAble
    // gate + the array-index lookup in CProject::GetItemProp, Project.h:1322).
    const picked = [...matches]
      .filter((m) => items.definedIds.has(m.id))
      .sort((a, b) => a.level_req - b.level_req)
      .slice(0, Math.max(0, v.totalNum));
    for (const m of picked) place(v.slot, m.id);
  }
  for (const v of charBlock.vendorItemIds) {
    if (items.definedIds.has(v.itemId)) place(v.slot, v.itemId);
  }
  for (const row of tabs) {
    while (row.length < VENDOR_TAB_SLOTS) row.push(null);
  }
  return Object.freeze(tabs.map((row) => Object.freeze(row))) as VendorStock;
}

/**
 * Deterministic per-index offset so `count` monsters of one spawn point don't
 * stack on a single coord. Vogel/sunflower distribution (golden-angle stride +
 * sqrt radius) gives an even, non-overlapping spread within half the spawn
 * radius. Deterministic (no Math.random) -- boot-time stable + reproducible.
 *
 * @param i      - 0-based instance index within the spawn point.
 * @param count  - total instances at this spawn point.
 */
function jitter(pos: Vec3, radius: number, i: number, count: number): Vec3 {
  if (radius <= 0 || count <= 1) return { ...pos };
  const GOLDEN_ANGLE = 2.39996323; // radians -- Vogel's sunflower stride
  const theta = i * GOLDEN_ANGLE;
  const r = radius * 0.5 * Math.sqrt((i + 0.5) / count);
  return { x: pos.x + r * Math.cos(theta), y: pos.y, z: pos.z + r * Math.sin(theta) };
}

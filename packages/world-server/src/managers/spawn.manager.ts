/**
 * SpawnManager — materializes zone spawns into live {@link CMover}s at boot.
 *
 * Reads each loaded zone's `npcs` list (static human/quest NPCs) and `spawns`
 * list (monster spawn points with `count`), resolves the mover definition from
 * the resource index, and instantiates one {@link CMover} per placement —
 * carrying the NPC `outfit` (character.inc SetFigure/SetEquip) through to the
 * wire serializer so equipped NPCs render with gear.
 *
 * Wire objids start at `FIRST_MOVER_ID` (0x40000000) — high-bit range,
 * disjoint from player char ids so the client never confuses NPC and player
 * objids (memory: v15-npc-addobj-method-exclude-item).
 *
 * Respawn: on `kill(id)`, if the mover's spawn `delay > 0` (monsters only), a
 * `setTimeout` re-materializes it at the same placement after `delay` ms and
 * fires `onSpawn(mover)` so the compose root can broadcast its ADD_OBJ to the
 * zone. Static NPCs pass `delay=0` and never respawn (they don't die anyway).
 * Timers are tracked and cleared on `shutdown()` (rule 05 — no leaked timers).
 *
 * No tick loop, no AI here (rule 05 — Systems do per-tick work; the AI system
 * is blocked, see PROGRESS.md). Pure in-memory state + per-respawn timer.
 *
 * @module managers/spawn.manager
 */

import type { ResourceIndex } from '@flyff/resources';
import type { Vec3 } from '../entities/player.js';
import { CMover, type MoverSpawnSource, type MoverOutfit } from '../entities/mover.js';
import { createLogger } from '@flyff/core/logger.js';

const logger = createLogger({ module: 'spawn-manager' });

/** First object id assigned to a non-player mover (player char ids stay below). */
const FIRST_MOVER_ID = 0x40000000;

/** Cap on monsters materialized per spawn point — bounds memory on bad data. */
const MAX_PER_SPAWN = 50;

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
  /** objid → respawn descriptor, so `kill` can schedule a replacement. */
  private readonly descs = new Map<number, SpawnDesc>();
  /** Live respawn timers — cleared on `shutdown()` (rule 05). */
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
      // Static NPCs (shopkeepers, quest NPCs) — carry outfit if defined.
      for (const npcSpawn of zone.npcs) {
        const def = movers.movers.get(npcSpawn.mover_id);
        if (!def) {
          logger.warn({ moverId: npcSpawn.mover_id, zone: zone._id }, 'NPC mover def missing — skipping');
          continue;
        }
        this.materialize({
          src: {
            modelIndex: def.dwObjIndex,
            key: def.key,
            name: def.name,
            level: def.level,
            hp: def.hp,
            scale: def.scale,
            outfit: toOutfit(def),
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
          delayMs: 0, // static NPC — never respawns
        });
      }

      // Monster spawn points — `count` instances around `position`.
      for (const spawn of zone.spawns) {
        const def = movers.movers.get(spawn.mover_id);
        if (!def) {
          logger.warn({ moverId: spawn.mover_id, zone: zone._id }, 'Monster mover def missing — skipping');
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
   * `Delete()` immediately — no corpse, no death animation state on the server.
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

/** Map a validated mover definition's outfit block to the entity outfit shape. */
function toOutfit(def: { outfit?: { characterKey: string; hairMesh: number; hairColor: number; headMesh: number; equip: ReadonlyArray<{ parts: number; itemId: number }> } | undefined }): MoverOutfit | undefined {
  const o = def.outfit;
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
 * Deterministic per-index offset so `count` monsters of one spawn point don't
 * stack on a single coord. Vogel/sunflower distribution (golden-angle stride +
 * sqrt radius) gives an even, non-overlapping spread within half the spawn
 * radius. Deterministic (no Math.random) — boot-time stable + reproducible.
 *
 * @param i      - 0-based instance index within the spawn point.
 * @param count  - total instances at this spawn point.
 */
function jitter(pos: Vec3, radius: number, i: number, count: number): Vec3 {
  if (radius <= 0 || count <= 1) return { ...pos };
  const GOLDEN_ANGLE = 2.39996323; // radians — Vogel's sunflower stride
  const theta = i * GOLDEN_ANGLE;
  const r = radius * 0.5 * Math.sqrt((i + 0.5) / count);
  return { x: pos.x + r * Math.cos(theta), y: pos.y, z: pos.z + r * Math.sin(theta) };
}

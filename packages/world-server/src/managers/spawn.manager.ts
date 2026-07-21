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
 * No tick, no respawn, no AI here yet (rule 05 — Systems do per-tick work; the
 * combat/AI systems are blocked, see PROGRESS.md). Pure in-memory state.
 *
 * ponytail: respawn-on-death and timed respawns land with the combat system.
 * When they do, add `kill(id)` + a respawn queue drained in `tick(dt)`.
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

export interface SpawnManagerDeps {
  resources: ResourceIndex;
}

export class SpawnManager {
  private readonly movers = new Map<number, CMover>();
  private nextId = FIRST_MOVER_ID;
  private readonly resources: ResourceIndex;

  constructor(deps: SpawnManagerDeps) {
    this.resources = deps.resources;
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
          modelIndex: def.dwObjIndex,
          name: def.name,
          level: def.level,
          hp: def.hp,
          scale: def.scale,
          outfit: toOutfit(def),
          attackable: def.attackable,
          guard: def.guard ?? false,
          belligerence: def.belligerence ?? 0,
        }, npcSpawn.position, npcSpawn.angle, zone._id_numeric);
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
            modelIndex: def.dwObjIndex,
            name: def.name,
            level: def.level,
            hp: def.hp,
            scale: def.scale,
            attackable: def.attackable,
            guard: def.guard ?? false,
            belligerence: def.belligerence ?? 0,
          }, jitter(spawn.position, spawn.radius), 0, zone._id_numeric);
        }
      }
    }
    logger.info({ count: this.movers.size }, 'Movers spawned');
  }

  /** Create + register a mover from a definition + placement. */
  private materialize(src: MoverSpawnSource, pos: Vec3, angle: number, zoneId: number): CMover {
    const id = this.nextId++;
    const mover = CMover.spawn(id, { ...src }, pos, zoneId);
    mover.m_fAngle = angle;
    this.movers.set(id, mover);
    return mover;
  }

  /** O(1) lookup by object id. */
  get(id: number): CMover | undefined {
    return this.movers.get(id);
  }

  /** Find a placed NPC by `character.inc` key (QUESTHELPER_REQNPCPOS target). */
  findByCharacterKey(key: string): CMover | undefined {
    for (const m of this.movers.values()) {
      if (m.outfit?.characterKey === key) return m;
    }
    return undefined;
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

/** Deterministic small offset so stacked spawns don't all sit on one point. */
function jitter(pos: Vec3, radius: number): Vec3 {
  if (radius <= 0) return { ...pos };
  // Deterministic pseudo-spread within radius (no Math.random — boot-time stable).
  const r = radius * 0.6;
  return { x: pos.x + r, y: pos.y, z: pos.z + r };
}

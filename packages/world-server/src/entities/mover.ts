/**
 * CMover — live in-world NPC/monster entity.
 *
 * Mirrors the C++ `CMover` (NPC branch) naming: `m_` prefix + Hungarian
 * notation so fields cross-reference `_Common/ObjSerializeOpt.cpp:319` (the
 * `else // NPC` serialize branch). Only the fields the client needs to render
 * the mover and the server needs to place it are modeled here; AI state,
 * aggro tables, loot, and respawn bookkeeping arrive with the combat/AI/
 * drop systems (PROGRESS.md Known Blockers).
 *
 * Distinct from `CPlayer` (which mirrors the player self-spawn branch): a
 * monster sends the short NPC ADD_OBJ body via `NpcSnapshotSerializer`, not
 * the full METHOD_NONE blob. `m_idMover` is a server-allocated object id in a
 * range that never overlaps player character ids (`SpawnManager` owns the
 * counter, starting at `0x40000000`).
 *
 * @module entities/mover
 */

import type { Vec3 } from './player.js';

/** One equipped part — C++ `m_Inventory.GetEquip(uParts)` iteration output. */
export interface MoverEquipPart {
  /** `uParts` (u_char) — body slot, PARTS_* from defineNeuz.h:26-35. */
  readonly parts: number;
  /** `m_dwItemId` (u_short) — propItem id (low 16 bits). */
  readonly itemId: number;
}

/**
 * Human-NPC outfit — C++ `character.inc` `SetFigure` + `SetEquip`
 * (`_Common/Project.cpp:2928-2968`). Serialized in the NPC branch of
 * `CMover::Serialize` (`ObjSerializeOpt.cpp:319-352`). Undefined for monsters.
 */
export interface MoverOutfit {
  readonly characterKey: string;
  readonly hairMesh: number;
  readonly hairColor: number;
  readonly headMesh: number;
  readonly equip: readonly MoverEquipPart[];
}

/** Fields required to spawn a monster instance (from a spawn definition). */
export interface MoverSpawnSource {
  /** propMover row index (MI_* define) → `dwObjIndex` / `m_dwIndex`. */
  readonly modelIndex: number;
  readonly level: number;
  readonly hp: number;
  readonly name: string;
  /** Model scale (1.0 default); written as `m_vScale.x * 100`. */
  readonly scale?: number | undefined;
  /** Human-NPC outfit (character.inc SetFigure/SetEquip). Omit for monsters. */
  readonly outfit?: MoverOutfit | undefined;
}

/**
 * Live monster. Constructed by `SpawnManager` at boot (and on future respawn);
 * destroyed when killed (combat system) or the world tears down.
 */
export class CMover {
  /** Server-allocated object id (C++ `GetId()` / `m_objid`). */
  m_idMover: number;
  /** propMover model index (C++ `m_dwIndex`). */
  m_dwIndex: number;
  m_szName: string;
  m_nLevel: number;
  /** Current HP (C++ `m_nHitPoint`). */
  m_nHitPoint: number;
  m_nMaxHitPoint: number;
  m_vPos: Vec3;
  /** Y-axis rotation (C++ `m_fAngle`); written as `(short)(m_fAngle * 10)`. */
  m_fAngle: number;
  /** Model scale (C++ `m_vScale.x`); written as `(u_short)(scale * 100)`. */
  m_vScale: number;
  m_nZoneId: number;
  /** Aggressiveness (C++ `m_dwBelligerence`); 0 = peaceful. */
  m_dwBelligerence: number;
  /** Aggro-on-sight flag (C++ `m_bActiveAttack`); 0 until AI lands. */
  m_bActiveAttack: number;
  /** AI speed multiplier (C++ `m_fSpeedFactor`); 1.0 = propMover speed. */
  m_fSpeedFactor: number;
  /** Human-NPC outfit (character.inc). Undefined for monsters → naked spawn. */
  readonly outfit?: MoverOutfit | undefined;

  private constructor(
    id: number,
    src: MoverSpawnSource,
    pos: Vec3,
    zoneId: number,
  ) {
    this.m_idMover = id;
    this.m_dwIndex = src.modelIndex;
    this.m_szName = src.name;
    this.m_nLevel = src.level;
    this.m_nHitPoint = src.hp;
    this.m_nMaxHitPoint = src.hp;
    this.m_vPos = { ...pos };
    this.m_fAngle = 0;
    this.m_vScale = src.scale ?? 1.0;
    this.m_nZoneId = zoneId;
    this.m_dwBelligerence = 0;
    this.m_bActiveAttack = 0;
    this.m_fSpeedFactor = 1.0;
    this.outfit = src.outfit;
  }

  /** Spawn a live monster from a definition + position. Caller assigns the id. */
  static spawn(
    id: number,
    src: MoverSpawnSource,
    pos: Vec3,
    zoneId: number,
  ): CMover {
    return new CMover(id, src, pos, zoneId);
  }
}

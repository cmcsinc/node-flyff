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
  /** Symbolic `MI_*` name (defineObj.h) → resolves NPC dialog prefix. Omit for monsters. */
  readonly key?: string | undefined;
  readonly level: number;
  readonly hp: number;
  readonly name: string;
  /** Model scale (1.0 default); written as `m_vScale.x * 100`. */
  readonly scale?: number | undefined;
  /** Human-NPC outfit (character.inc SetFigure/SetEquip). Omit for monsters. */
  readonly outfit?: MoverOutfit | undefined;
  /** C++ `bKillable` + peaceful flag collapsed — may be targeted for attack. */
  readonly attackable?: boolean | undefined;
  /** C++ `RANK_GUARD` — town guard; PK-gated attackability. */
  readonly guard?: boolean | undefined;
  /**
   * C++ `m_dwBelligerence` (defineAttribute.h:203-215). 1 = BELLI_PEACEFUL
   * (suppresses client attack cursor); 11/12/13 = aggressive. 0 = unspecified.
   */
  readonly belligerence?: number | undefined;
  /**
   * Combat stats (propMover cols). Populated by `SpawnManager` from the mover
   * definition. ponytail: yml `attack` is a single field — split into raw
   * `dwAtkMin/Max` when the resources converter exports them separately.
   */
  readonly atkMin?: number | undefined;
  readonly atkMax?: number | undefined;
  /** `dwNaturalArmor` (propMover col 35) — NPC melee DEF source. */
  readonly armor?: number | undefined;
  /** `dwHR` (col 6) — NPC hit rate. */
  readonly hr?: number | undefined;
  /** `dwER` (col 7) — NPC parrying / evasion. */
  readonly er?: number | undefined;
  /** `nExpValue` (col 58) — base exp granted on kill. */
  readonly expValue?: number | undefined;
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
  /** Symbolic `MI_*` name (defineObj.h); resolves NPC dialog prefix. Empty for monsters. */
  m_szKey: string;
  m_szName: string;
  m_nLevel: number;
  /** Current HP (C++ `m_nHitPoint`). */
  m_nHitPoint: number;
  m_nMaxHitPoint: number;
  m_vPos: Vec3;
  /**
   * Spawn anchor — C++ `CAIMonster::m_vPosBegin` (`AIMonster.cpp:127-132`), set
   * once at materialize from the spawn position. The idle-wander AI leashes
   * within `RANGE_MOVE` (30 m) of this point and returns here on evade.
   */
  m_vPosBegin: Vec3;
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
  /**
   * Next wall-clock ms the monster may swing back (C++ `OnActTimer` cadence).
   * 0 = may retaliate now. Throttle on the reactive counter-swing path; bumped
   * after each retaliation by `RETALIATE_COOLDOWN_MS / m_fSpeedFactor`.
   * ponytail: replaced by the AI tick (`CMover::OnActTimer`) when it lands.
   */
  m_nextAttackTick: number = 0;
  /** C++ `bKillable` + peaceful flag collapsed — may be targeted for attack. */
  m_bAttackable: boolean;
  /** C++ `RANK_GUARD` — town guard; only chaotic/PK players may attack. */
  m_bGuard: boolean;
  /** Human-NPC outfit (character.inc). Undefined for monsters → naked spawn. */
  readonly outfit?: MoverOutfit | undefined;
  /** NPC attack min/max (propMover `dwAtkMin/Max`). */
  m_nAtkMin: number;
  m_nAtkMax: number;
  /** NPC melee DEF source (propMover `dwNaturalArmor`). */
  m_nArmor: number;
  /** NPC hit rate / parrying (propMover `dwHR`/`dwER`). */
  m_nHR: number;
  m_nER: number;
  /** Base exp granted on kill (propMover `nExpValue`). */
  m_nExpValue: number;
  /** Mover element (propMover `eElementType`); 0 = NO_PROP. */
  m_nElement: number;
  /** Combat death flag — set on lethal damage; swept from the spawn map on tick. */
  m_bDead: boolean = false;
  /**
   * Timestamp (ms, `Date.now()`) when this mover next picks an idle-wander
   * destination. `0` = uninitialized → the AI stagger-seeds it on first tick.
   * C++ drives this from `m_tmMove` + `SEC(5)+xRandom(SEC(1))` on arrival.
   */
  m_tmNextWander: number = 0;
  /**
   * Hit-share table for kill exp (`m_idEnemies`). OBJID → cumulative damage.
   * v1: single-attacker (no party grouping). ponytail: full HIT_INFO + party.
   */
  readonly m_idEnemies = new Map<number, number>();

  private constructor(
    id: number,
    src: MoverSpawnSource,
    pos: Vec3,
    zoneId: number,
  ) {
    this.m_idMover = id;
    this.m_dwIndex = src.modelIndex;
    this.m_szKey = src.key ?? '';
    this.m_szName = src.name;
    this.m_nLevel = src.level;
    this.m_nHitPoint = src.hp;
    this.m_nMaxHitPoint = src.hp;
    this.m_vPos = { ...pos };
    this.m_vPosBegin = { ...pos };
    this.m_fAngle = 0;
    this.m_vScale = src.scale ?? 1.0;
    this.m_nZoneId = zoneId;
    this.m_dwBelligerence = src.belligerence ?? 0;
    this.m_bActiveAttack = 0;
    this.m_fSpeedFactor = 1.0;
    this.m_bAttackable = src.attackable ?? true;
    this.m_bGuard = src.guard ?? false;
    this.outfit = src.outfit;
    this.m_nAtkMin = src.atkMin ?? 0;
    this.m_nAtkMax = src.atkMax ?? src.atkMin ?? 0;
    this.m_nArmor = src.armor ?? 0;
    this.m_nHR = src.hr ?? 0;
    this.m_nER = src.er ?? 0;
    this.m_nExpValue = src.expValue ?? 0;
    this.m_nElement = 0;
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

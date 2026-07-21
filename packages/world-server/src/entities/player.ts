/**
 * CPlayer — live in-world player entity.
 *
 * Mirrors the C++ `CPlayer` (extends `CMover`) naming: `m_` prefix and
 * Hungarian notation so fields cross-reference the original source. Only the
 * subset needed for the enter-world vertical slice is modeled here; combat,
 * inventory, skills come in later milestones.
 *
 * The entity holds a weakly-typed socket reference (`{ write }`) so the zone
 * manager can broadcast to it without this module depending on `node:net`
 * (rule 02 — entities carry no packet logic; they only expose the sink).
 *
 * @module entities/player
 */

import type { CharacterRow } from '@flyff/database';
import { NULL_ID } from '../net/snapshot/constants.js';

/** Minimal write-capable socket view a player holds for broadcasts. */
export interface PlayerSocket {
  write(buf: Buffer): boolean;
}

/** D3DVECTOR stand-in — C++ `m_vPos`. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * In-world player. Constructed from a DB row on JOIN; destroyed on disconnect.
 * `m_`-prefixed fields mirror C++ and are persisted (tracked via `_dirty`).
 */
export class CPlayer {
  /** Character id (C++ `m_idPlayer`). */
  m_idPlayer: number;
  /** Account id (C++ `m_idPlayer` parent). */
  m_accountId: number;
  m_szName: string;
  m_nLevel: number;
  m_nJob: number;
  m_nSex: number;
  m_vPos: Vec3;
  m_nHp: number;
  m_nMp: number;
  m_nMaxHp: number;
  m_nMaxMp: number;
  m_nStr: number;
  m_nSta: number;
  m_nDex: number;
  m_nInt: number;
  m_dwSkin: number;
  m_nHairMesh: number;
  m_dwHairColor: number;
  m_nHeadMesh: number;
  m_worldId: string;
  m_nZoneId: number;
  /** Y-axis rotation (C++ `m_fAngle`). Updated by GETPOS/PLAYERANGLE. */
  m_fAngle: number = 0;
  /** Per-player target lock (C++ `m_idTarget`) — set by SETTARGET, consumed by combat. */
  m_idTarget: number = NULL_ID;
  /** Objective target id (C++ `m_idSetTarget`) — SETTARGET with bClear=2. */
  m_idSetTarget: number = NULL_ID;
  /** Last SCRIPTDLG tick (C++ `m_tickScript`) — 400ms rate limit (DPSrvr.cpp:903). */
  m_tickScript: number = 0;
  /**
   * One-shot: the zone's NPC/monster ADD_OBJ snapshot has been sent for this
   * player. Neuz sends MAP_KEY once per `.wld` as it loads the world; the
   * vicinity burst must fire only on the first (world-enter), not every map.
   */
  m_vicinitySent: boolean = false;
  readonly socket: PlayerSocket;
  /** Dirty field names pending the 30s partial flush (rule 04). */
  readonly _dirty: Set<string> = new Set();

  private constructor(row: CharacterRow, socket: PlayerSocket) {
    this.m_idPlayer = row.id;
    this.m_accountId = row.account_id;
    this.m_szName = row.name;
    this.m_nLevel = row.level;
    this.m_nJob = row.class;
    this.m_nSex = row.gender;
    this.m_vPos = { x: row.x, y: row.y, z: row.z };
    this.m_nHp = row.hp;
    this.m_nMp = row.mp;
    this.m_nMaxHp = row.max_hp;
    this.m_nMaxMp = row.max_mp;
    this.m_nStr = row.strength;
    this.m_nSta = row.stamina;
    this.m_nDex = row.dexterity;
    this.m_nInt = row.intelligence;
    this.m_dwSkin = row.skin_color;
    this.m_nHairMesh = row.hair_style;
    this.m_dwHairColor = row.hair_color;
    this.m_nHeadMesh = row.face_style;
    this.m_worldId = row.world_id;
    this.m_nZoneId = row.zone_id;
    this.socket = socket;
  }

  /** Build a live player from a persisted row + connected socket. */
  static fromRow(row: CharacterRow, socket: PlayerSocket): CPlayer {
    return new CPlayer(row, socket);
  }
}

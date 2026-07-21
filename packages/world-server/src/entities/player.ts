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
import { AUTH } from '../constants/authority.js';
import { NULL_ID } from '../net/snapshot/constants.js';
import { MAX_QUEST, MAX_COMPLETE_QUEST, MAX_CHECKED_QUEST, QS_END } from '@flyff/core/constants/quest.js';
import type { RuntimeQuest } from '../net/snapshot/quest.serializer.js';

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
  /**
   * Gold (C++ `m_nGold`). ponytail: no DB column on `characters` yet — persists
   * via WAL only until the column + repo update ship. Quest rewards mutate this.
   */
  m_nGold: number = 0;
  /**
   * Within-level experience (C++ `m_nExp1` delta): progress toward the next
   * level, 0 at each level boundary. On level-up the consumed portion is
   * subtracted and any excess carries over (see `combat/formulas.addExp`).
   * Hydrated on JOIN via `withinLevelExp`; the DB `exp` column and the
   * SETEXPERIENCE wire field store the cumulative value.
   */
  m_nExp: number = 0;
  m_dwSkin: number;
  m_nHairMesh: number;
  m_dwHairColor: number;
  m_nHeadMesh: number;
  m_worldId: string;
  m_nZoneId: number;
  /**
   * GM/admin rank (C++ `m_dwAuthorization`). Gates `/cmd` routing via
   * `cmd.auth <= m_bAuthority`. Loaded from `accounts.gm` on JOIN.
   * See `constants/authority.ts`.
   */
  m_bAuthority: number = AUTH.GENERAL;
  /** Y-axis rotation (C++ `m_fAngle`). Updated by GETPOS/PLAYERANGLE. */
  m_fAngle: number = 0;
  /** Per-player target lock (C++ `m_idTarget`) — set by SETTARGET, consumed by combat. */
  m_idTarget: number = NULL_ID;
  /** Objective target id (C++ `m_idSetTarget`) — SETTARGET with bClear=2. */
  m_idSetTarget: number = NULL_ID;
  /**
   * Walk-to-object destination (C++ `GetDestId()` / `SetDestObj`). Set by
   * PLAYERSETDESTOBJ; consumed by the pathfinding tick (not yet implemented).
   * Used now for `__TRAFIC_1223` dedup — repeat packets for the same obj drop.
   */
  m_idDestObj: number = NULL_ID;
  /**
   * Player-killer / chaotic disposition (C++ `m_dwPKPropensity`, Mover.h:1227 —
   * `IsChaotic()` = `> 0`). Gates guard attackability. ponytail: set on
   * player-kill + persist to a DB column; no source yet, defaults non-PK.
   */
  m_dwPKPropensity: number = 0;
  /** Last SCRIPTDLG tick (C++ `m_tickScript`) — 400ms rate limit (DPSrvr.cpp:903). */
  m_tickScript: number = 0;
  /**
   * One-shot: the zone's NPC/monster ADD_OBJ snapshot has been sent for this
   * player. Neuz sends MAP_KEY once per `.wld` as it loads the world; the
   * vicinity burst must fire only on the first (world-enter), not every map.
   */
  m_vicinitySent: boolean = false;
  /**
   * Per-player quest state — in-memory mirror of the C++ per-mover arrays
   * (`_Common/Mover.h:702-709`). Loaded from the DB on JOIN; mutated by the
   * quest service; persisted via dirty-flag flush + `QuestRepository`.
   */
  m_aQuest: RuntimeQuest[] = [];
  m_aCompleteQuest: number[] = [];
  m_aCheckedQuest: number[] = [];
  readonly socket: PlayerSocket;
  /** Dirty field names pending the 30s partial flush (rule 04). */
  readonly _dirty: Set<string> = new Set();

  private constructor(row: CharacterRow, socket: PlayerSocket, authority: number) {
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
    this.m_bAuthority = authority;
    this.socket = socket;
  }

  /** Build a live player from a persisted row + connected socket. */
  static fromRow(row: CharacterRow, socket: PlayerSocket, authority: number = AUTH.GENERAL): CPlayer {
    return new CPlayer(row, socket, authority);
  }

  /** C++ `IsChaotic()` (Mover.h:1227) — player-killer state (PK). */
  isChaotic(): boolean {
    return this.m_dwPKPropensity > 0;
  }

  // --- Quest state helpers (mirror `_Common/MoverParam.cpp`) ---

  /** `CMover::FindQuest` — linear scan of the active list by id. */
  findQuest(questId: number): RuntimeQuest | undefined {
    return this.m_aQuest.find((q) => q.id === questId);
  }

  /** `CMover::IsCompleteQuest` — true if id is in the completed list. */
  isCompleteQuest(questId: number): boolean {
    return this.m_aCompleteQuest.includes(questId);
  }

  /**
   * `CMover::SetQuest` — upsert an active quest. Refuses if already complete.
   * At `QS_END` the quest moves to the completed list (mirrors `__SetQuest`).
   * Returns the active record, or a synthesized completed record on QS_END.
   */
  setQuest(q: RuntimeQuest): RuntimeQuest {
    if (this.isCompleteQuest(q.id)) {
      return { state: QS_END, time: 0, id: q.id, killNpcNum: [0, 0], flags: 0 };
    }
    const existing = this.findQuest(q.id);
    if (existing) {
      Object.assign(existing, q);
    } else if (this.m_aQuest.length < MAX_QUEST) {
      this.m_aQuest.push({ ...q });
    }
    if (q.state === QS_END) {
      this.removeQuest(q.id);
      if (this.m_aCompleteQuest.length < MAX_COMPLETE_QUEST) this.m_aCompleteQuest.push(q.id);
    }
    this._dirty.add('m_aQuest');
    return this.findQuest(q.id) ?? q;
  }

  /** `CMover::RemoveQuest` — drop from active + completed + checked lists. */
  removeQuest(questId: number): void {
    this.m_aQuest = this.m_aQuest.filter((q) => q.id !== questId);
    this.m_aCompleteQuest = this.m_aCompleteQuest.filter((id) => id !== questId);
    this.m_aCheckedQuest = this.m_aCheckedQuest.filter((id) => id !== questId);
    this._dirty.add('m_aQuest');
  }

  /**
   * `CMover::AddCheckedQuest` — toggle a quest in the "checked" (tracked) list
   * (cap `MAX_CHECKED_QUEST`, newest-first). Returns the resulting list. Driven
   * by `PACKETTYPE_QUEST_CHECK`; persisted by `QuestService.setChecked`.
   */
  setCheckedQuest(questId: number, check: boolean): number[] {
    const idx = this.m_aCheckedQuest.indexOf(questId);
    if (check && idx === -1) {
      this.m_aCheckedQuest.unshift(questId);
      if (this.m_aCheckedQuest.length > MAX_CHECKED_QUEST)
        this.m_aCheckedQuest.length = MAX_CHECKED_QUEST;
    } else if (!check && idx !== -1) {
      this.m_aCheckedQuest.splice(idx, 1);
    }
    this._dirty.add('m_aCheckedQuest');
    return this.m_aCheckedQuest;
  }
}

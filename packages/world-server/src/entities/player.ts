/**
 * CPlayer -- live in-world player entity.
 *
 * Mirrors the C++ `CPlayer` (extends `CMover`) naming: `m_` prefix and
 * Hungarian notation so fields cross-reference the original source. Only the
 * subset needed for the enter-world vertical slice is modeled here; combat,
 * inventory, skills come in later milestones.
 *
 * The entity holds a weakly-typed socket reference (`{ write }`) so the zone
 * manager can broadcast to it without this module depending on `node:net`
 * (rule 02 -- entities carry no packet logic; they only expose the sink).
 *
 * @module entities/player
 */

import type { CharacterRow } from '@flyff/database';
import { AUTH } from '../constants/authority.js';
import { NULL_ID, INVENTORY_SLOTS, BANK_SLOTS, MAX_SKILL_JOB, MAX_SLOT_ITEM_COUNT, MAX_SLOT_ITEM, SHORTCUT } from '../net/snapshot/constants.js';
import { MAX_QUEST, MAX_COMPLETE_QUEST, MAX_CHECKED_QUEST, QS_END } from '@flyff/core/constants/quest.js';
import type { RuntimeQuest } from '../net/snapshot/quest.serializer.js';

/**
 * Minimal write-capable socket view a player holds for broadcasts.
 * `destroy` is optional -- only the live `net.Socket` provides it; tests/mocks
 * omit it. `/out` uses it to force-disconnect a named target.
 */
export interface PlayerSocket {
  write(buf: Buffer): boolean;
  destroy?(): void;
}

/** D3DVECTOR stand-in -- C++ `m_vPos`. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * One `m_aJobSkill[45]` slot (C++ `SKILL` struct, sizeof=8). Empty slots use
 * `skillId = NULL_ID` (0xffffffff) -- the C++ sentinel for "no skill".
 * See `_Common/Item.h:308`, docs `skills-research.md` #5.
 */
export interface SkillSlot {
  /** Resolved SI_* skill id. NULL_ID (0xffffffff) = empty slot. */
  skillId: number;
  /** Learned skill level (1..dwExpertMax). 0 = empty slot. */
  level: number;
}

/** Build an empty skill-slot array (45 slots, all NULL_ID/0). */
function emptySkillSlots(): SkillSlot[] {
  return Array.from({ length: MAX_SKILL_JOB }, () => ({ skillId: NULL_ID, level: 0 }));
}

/**
 * One taskbar hotkey slot (C++ `SHORTCUT`, `_Common/ProjectCmn.h:939-948`).
 * `dwShortcut` is the SHORTCUT_* discriminant (NONE=0 = empty). `szString` is
 * only carried when `dwShortcut === SHORTCUT_CHAT`. Mirrors the ADDITEMTASKBAR
 * body (`DPClient.cpp:10880`). Persisted to `characters.taskbar` (migration
 * 009) and hydrated on JOIN via `decodeTaskBar`; repushed to the client as
 * `SNAPSHOTTYPE_TASKBAR`.
 */
export interface Shortcut {
  dwShortcut: number;
  dwId: number;
  dwType: number;
  dwIndex: number;
  dwUserId: number;
  dwData: number;
  szString?: string;
}

/** Build an empty taskbar grid (`MAX_SLOT_ITEM_COUNT` x `MAX_SLOT_ITEM`). */
function emptyTaskBar(): Shortcut[][] {
  return Array.from({ length: MAX_SLOT_ITEM_COUNT }, () =>
    Array.from({ length: MAX_SLOT_ITEM }, () => ({ dwShortcut: SHORTCUT.NONE, dwId: 0, dwType: 0, dwIndex: 0, dwUserId: 0, dwData: 0 })),
  );
}

/**
 * One inventory slot (C++ `CItemElem`, vanilla subset). `itemId` is the propItem
 * id; `count` is `m_nItemNum`. Upgrade fields carry refine/flag/durability so
 * equipped items serialize correctly on JOIN; defaults are 0 (vanilla drop).
 */
export interface InventorySlot {
  itemId: number;
  count: number;
  /**
   * Stable per-item id (v15 `CItemElem::m_dwObjId`). Assigned ONCE at creation
   * (JOIN: the slot index; pickup/CREATEITEM: the slot index) and NEVER changed
   * by equip/unequip/move -- the client addresses items by this id (`OnDoEquip`
   * `GetAtId`, `IsEquip`, Item.h:599). Our flat array moves items between slots
   * on equip/unequip, so without this field we lose the client's stable handle
   * and can't resolve an unequip of a session-equipped item. Optional only so
   * bare test fixtures compile; production always sets it.
   */
  objid?: number;
  /** CItemElem m_byFlag (elemental/rarity bits). 0 = plain. */
  flags?: number;
  /** Refine level (+0..+20). Shifted into nOption on the wire. */
  refine?: number;
  /** Durability / m_nHitPoint. -1 = indestructible. */
  durability?: number;
  /** Element type (CItemElem m_bItemResist; NO_PROP=0, FIRE=1...EARTH=5). Instance upgrade state. */
  element?: number;
  /** Element level (CItemElem m_nResistAbilityOption). Instance upgrade state. */
  element_level?: number;
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
  /**
   * Dead flag (C++ `m_dwState & OBJSTA_DIE_ALL` / `IsDie()`). Set true by
   * `RevivalService.onPlayerDeath` when `m_nHp <= 0`; cleared on revive. Dead
   * players are skipped as AI targets and rejected by non-dead revive paths.
   * ponytail: full `m_dwState` bitfield if more state bits are ever needed.
   */
  m_bDead: boolean = false;
  m_nStr: number;
  m_nSta: number;
  m_nDex: number;
  m_nInt: number;
  /**
   * Unspent stat points (C++ `m_nRemainGP`, "growth points"). Granted on
   * level-up from `EXPCHARACTER.dwLPPoint` (`Mover.cpp:1601`), spent 1:1 into
   * STR/STA/DEX/INT via `PACKETTYPE_MODIFY_STATUS`. Persisted on the
   * `characters.remain_gp` column (migration 010); hydrated on JOIN.
   */
  m_nRemainGP: number = 0;
  /**
   * Gold (C++ `m_nGold`). Persisted on the `inventory` container row's `gold`
   * column (migration 008 -- gold is a container attribute, not a character
   * one). Hydrated on JOIN via `InventoryRepository.getGold`; fire-and-forget
   * flushed by the inventory/quest/bank/command services. WAL `CHAR_GOLD` is
   * the crash-recovery backup.
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
  /**
   * Runtime mode bitmask (C++ `CMover::m_dwMode`, authorization.h:18). Holds GM
   * toggles -- `MATCHLESS_MODE` (`/undying`, invincible), `TRANSPARENT_MODE`
   * (`/inv`, invisible). See `constants/mode.ts`. Transient -- not persisted,
   * resets each session (matches C++). Mutated by `/cmd` and broadcast via
   * `SNAPSHOTTYPE_MODIFYMODE`. MATCHLESS is honored by `AISystem.monsterSwing`
   * (skip HP subtraction). ponytail: add a `mode` column + JOIN hydration if a
   * bit must survive reconnect.
   */
  m_dwMode: number = 0;
  /**
   * Disguise propMover index (C++ disguise `m_dwIndex`). 0 = none. Set by
   * `/dis`, cleared by `/nodis`, broadcast via `SNAPSHOTTYPE_DISGUISE`. The
   * client renders the player as this mover model. ponytail: persist + hydrate
   * on JOIN so a disguise survives reconnect.
   */
  m_dwDisguise: number = 0;
  /** Y-axis rotation (C++ `m_fAngle`). Updated by GETPOS/PLAYERANGLE. */
  m_fAngle: number = 0;
  /** Per-player target lock (C++ `m_idTarget`) -- set by SETTARGET, consumed by combat. */
  m_idTarget: number = NULL_ID;
  /** Objective target id (C++ `m_idSetTarget`) -- SETTARGET with bClear=2. */
  m_idSetTarget: number = NULL_ID;
  /**
   * Walk-to-object destination (C++ `GetDestId()` / `SetDestObj`). Set by
   * PLAYERSETDESTOBJ; consumed by the pathfinding tick (not yet implemented).
   * Used now for `__TRAFIC_1223` dedup -- repeat packets for the same obj drop.
   */
  m_idDestObj: number = NULL_ID;
  /**
   * Walk-to-object arrival range (C++ `CMover::m_fArrivalRange`). Set alongside
   * `m_idDestObj` by PLAYERSETDESTOBJ; echoed back by QUERYGETDESTOBJ replies.
   */
  m_fArrivalRange: number = 0;
  /**
   * Player-killer / chaotic disposition (C++ `m_dwPKPropensity`, Mover.h:1227 --
   * `IsChaotic()` = `> 0`). Gates guard attackability. ponytail: set on
   * player-kill + persist to a DB column; no source yet, defaults non-PK.
   */
  m_dwPKPropensity: number = 0;
  /** Last SCRIPTDLG tick (C++ `m_tickScript`) -- 400ms rate limit (DPSrvr.cpp:903). */
  m_tickScript: number = 0;
  /**
   * One-shot: the zone's NPC/monster ADD_OBJ snapshot has been sent for this
   * player. Neuz sends MAP_KEY once per `.wld` as it loads the world; the
   * vicinity burst must fire only on the first (world-enter), not every map.
   */
  m_vicinitySent: boolean = false;
  /**
   * Per-player quest state -- in-memory mirror of the C++ per-mover arrays
   * (`_Common/Mover.h:702-709`). Loaded from the DB on JOIN; mutated by the
   * quest service; persisted via dirty-flag flush + `QuestRepository`.
   */
  m_aQuest: RuntimeQuest[] = [];
  m_aCompleteQuest: number[] = [];
  m_aCheckedQuest: number[] = [];
  /**
   * In-memory inventory -- one `InventorySlot` per occupied slot, `null` when
   * empty. Sized `INVENTORY_SLOTS` (73 = 42 main bag + 31 equip parts) to match
   * the client's `CItemContainer`. Hydrated from `InventoryRepository` on JOIN;
   * mutated by the pickup path (Phase E) + persisted fire-and-forget per
   * change (matches the gold/exp write-through pattern -- no 30 s flush loop).
   * Indexes 0..MAX_INVENTORY-1 are the main bag; 42..72 are equip parts.
   */
  m_Inventory: (InventorySlot | null)[] = new Array(INVENTORY_SLOTS).fill(null);
  /**
   * Bank tabs (C++ `m_Bank[3]`, 42 slots each). Per-character in v15. Hydrated
   * from `BankRepository` on JOIN; mutated by the bank service. Tab 0..2.
   */
  m_Bank: (InventorySlot | null)[][] = [
    new Array(BANK_SLOTS).fill(null),
    new Array(BANK_SLOTS).fill(null),
    new Array(BANK_SLOTS).fill(null),
  ];
  /** Per-tab bank gold (C++ `m_dwGoldBank[3]`). */
  m_BankGold: [number, number, number] = [0, 0, 0];
  /**
   * Taskbar hotkey bindings (C++ `m_playTaskBar.m_aSlotItem[8][9]`). Mutated by
   * ADDITEMTASKBAR / REMOVEITEMTASKBAR; in-memory only (matches the C++ handler
   * which does not persist here). ponytail: save on disconnect when relog-
   * retention is needed.
   */
  m_aSlotItem: Shortcut[][] = emptyTaskBar();
  /** True while the bank window is open (NPC range / instant-bank). */
  m_bBankOpen: boolean = false;
  /**
   * Bank password (C++ `m_szBankPass`, char[5]). `'0000'` = no password set
   * (bank opens directly); any other value prompts CONFIRMBANK. Max 4 chars,
   * changed via CHANGEBANKPASS. Account-wide (one pin per account) -- hydrated
   * on JOIN from the `bank` container row (`BankRepository.getBankPass`).
   */
  m_szBankPass: string = '0000';
  /**
   * The vendor NPC objid the player is currently interacting with
   * (C++ `m_vtInfo.GetOther()` / `SetOther()`). Set by OPENSHOPWND, cleared by
   * CLOSESHOPWND / LEAVE. Future BUYITEM/SELLITEM handlers gate on this.
   */
  m_idOther: number | null = null;
  /**
   * Fatigue point pool (C++ `m_nFatiguePoint`). Consumables (food/potion) restore
   * it; most skills spend it. ponytail: real FP regen + skill spend once skills ship.
   */
  m_nFp: number = 0;
  m_nMaxFp: number = 0;
  /**
   * Wall-clock of the last damage-taken event (`Date.now()`). Gates stand regen
   * -- C++ `IsAttackMode()` (`m_nAtkCnt < SEC1*10`) blocks `ProcessRecovery` for
   * 10 s after the last hit. Set by `AISystem.monsterSwing` on damage dealt;
   * 0 = never hit (regen immediate). Transient -- not persisted.
   */
  m_tmLastDamage: number = 0;
  /**
   * Next stand-regen tick (`Date.now()`). C++ `m_dwTickRecoveryStand` advances
   * by `NEXT_TICK_RECOVERYSTAND` (3 s) each fire. Transient -- not persisted.
   */
  m_tmNextRecovery: number = 0;
  /**
   * Per-slot learned skills (C++ `m_aJobSkill[45]`, sizeof 8 each). Slot ranges:
   * 0-2 vagrant, 3-22 expert, 23-42 pro, 43 master, 44 hero. Empty slots carry
   * `skillId = NULL_ID`. Hydrated from `SkillRepository` on JOIN; mutated by the
   * learn handler (DOUSESKILLPOINT). ponytail: persist via skill repo on learn.
   */
  m_aJobSkill: SkillSlot[] = emptySkillSlots();
  /**
   * Total skill points earned (C++ `m_nSkillLevel`). Persisted on
   * `characters.skill_level` (migration 005). Earned on level-up via
   * `((level-1)/20)+2` (MoverParam.cpp:1434). Never decremented.
   */
  m_nSkillLevel: number = 0;
  /**
   * Unspent skill points (C++ `m_nSkillPoint`). Persisted on
   * `characters.skill_point` (migration 005). Decremented by the learn handler
   * (DOUSESKILLPOINT) at the per-tier cost: vagrant 1, expert 2, pro/master/hero 3.
   */
  m_nSkillPoint: number = 0;
  /**
   * Per-slot cooldown timestamps (C++ `m_tmReUseDelay[45]`). Set to
   * `Date.now() + cooldownMs` on cast; `0` = ready. Indexed by slot, NOT skill id.
   * ponytail: persisted only on graceful disconnect (transient state).
   */
  m_tmReUseDelay: number[] = new Array(MAX_SKILL_JOB).fill(0);
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
    this.m_fAngle = row.angle ?? 0;
    this.m_nHp = row.hp;
    this.m_nMp = row.mp;
    this.m_nMaxHp = row.max_hp;
    this.m_nMaxMp = row.max_mp;
    this.m_nStr = row.strength;
    this.m_nSta = row.stamina;
    this.m_nDex = row.dexterity;
    this.m_nInt = row.intelligence;
    this.m_nRemainGP = row.remain_gp ?? 0;
    this.m_dwSkin = row.skin_color;
    this.m_nHairMesh = row.hair_style;
    this.m_dwHairColor = row.hair_color;
    this.m_nHeadMesh = row.face_style;
    this.m_worldId = row.world_id;
    this.m_nZoneId = row.zone_id;
    this.m_bAuthority = authority;
    this.m_nSkillPoint = row.skill_point ?? 0;
    this.m_nSkillLevel = row.skill_level ?? 0;
    this.socket = socket;
  }

  /** Build a live player from a persisted row + connected socket. */
  static fromRow(row: CharacterRow, socket: PlayerSocket, authority: number = AUTH.GENERAL): CPlayer {
    return new CPlayer(row, socket, authority);
  }

  /**
   * Hydrate `m_aJobSkill` from a list of learned skills (C++ `OnDoUseSkillPoint`
   * stores by slot index). Empty slots keep the NULL_ID sentinel. Caller is
   * `JoinService.loadSkills` after the DB row resolves.
   */
  hydrateSkills(slots: ReadonlyArray<{ slot: number; skillId: number; level: number }>): void {
    for (const s of slots) {
      if (s.slot < 0 || s.slot >= this.m_aJobSkill.length) continue;
      if (s.skillId === NULL_ID || s.skillId === 0) continue;
      this.m_aJobSkill[s.slot] = { skillId: s.skillId, level: s.level };
    }
  }

  /**
   * Seed a fresh Vagrant's job-skill roster (3 slots pre-filled at level 0).
   * C++ seeds `SI_VAG_ONE_CLEANHIT` (1), `SI_VAG_ONE_BRANDISH` (2),
   * `SI_VAG_ONE_OVERCUT` (3) at slot 0/1/2 on character creation. Use after
   * creating a brand-new character -- no-op for existing characters.
   */
  seedVagrantRoster(): void {
    const VAGRANT_ROSTER = [1, 2, 3]; // SI_VAG_ONE_CLEANHIT/BRANDISH/OVERCUT
    for (let i = 0; i < VAGRANT_ROSTER.length && i < this.m_aJobSkill.length; i++) {
      this.m_aJobSkill[i] = { skillId: VAGRANT_ROSTER[i]!, level: 0 };
    }
    this._dirty.add('m_aJobSkill');
  }

  /** C++ `IsChaotic()` (Mover.h:1227) -- player-killer state (PK). */
  isChaotic(): boolean {
    return this.m_dwPKPropensity > 0;
  }

  // --- Quest state helpers (mirror `_Common/MoverParam.cpp`) ---

  /** `CMover::FindQuest` -- linear scan of the active list by id. */
  findQuest(questId: number): RuntimeQuest | undefined {
    return this.m_aQuest.find((q) => q.id === questId);
  }

  /** `CMover::IsCompleteQuest` -- true if id is in the completed list. */
  isCompleteQuest(questId: number): boolean {
    return this.m_aCompleteQuest.includes(questId);
  }

  /**
   * `CMover::SetQuest` -- upsert an active quest. Refuses if already complete.
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

  /** `CMover::RemoveQuest` -- drop from active + completed + checked lists. */
  removeQuest(questId: number): void {
    this.m_aQuest = this.m_aQuest.filter((q) => q.id !== questId);
    this.m_aCompleteQuest = this.m_aCompleteQuest.filter((id) => id !== questId);
    this.m_aCheckedQuest = this.m_aCheckedQuest.filter((id) => id !== questId);
    this._dirty.add('m_aQuest');
  }

  /**
   * `CMover::AddCheckedQuest` -- toggle a quest in the "checked" (tracked) list
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

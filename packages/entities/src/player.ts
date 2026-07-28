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
import { AUTH } from './constants/authority';
import { getJobProps } from './tables/job';
import type { JobProps } from './tables/job';
import { maxFatiguePoint, maxHitPoint, maxManaPoint } from './math/vitals';
import { MAX_JOB_LEVEL, MAX_EXP_LEVEL, MAX_LEVEL } from './math/expTable';
import { DST, CHRSTATE_BITS } from './constants/dst';
import { ParamModel, type DstEffect } from './params/ParamModel';
import { BuffManager } from './params/BuffManager';
import { NULL_ID, INVENTORY_SLOTS, MAX_INVENTORY, BANK_SLOTS, MAX_SKILL_JOB, MAX_SLOT_ITEM_COUNT, MAX_SLOT_ITEM, MAX_SLOT_QUEUE, SHORTCUT, MAX_COOLTIME_GROUP } from './constants/slots';
import { MAX_QUEST, MAX_COMPLETE_QUEST, MAX_CHECKED_QUEST, QS_END } from '@flyff/core/constants/quest';
import type { RuntimeQuest } from './state/quest';

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

/** Build an empty action-slot queue (`MAX_SLOT_QUEUE` skill slots). */
function emptySkillQueue(): Shortcut[] {
  return Array.from({ length: MAX_SLOT_QUEUE }, () => ({ dwShortcut: SHORTCUT.NONE, dwId: 0, dwType: 0, dwIndex: 0, dwUserId: 0, dwData: 0 }));
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
   * Stable per-item id (v19 `CItemElem::m_dwObjId`). Assigned ONCE at creation
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
  /**
   * Timed-item expiry (CItemElem `m_dwKeepTime`). Absolute server time in
   * SECONDS since epoch when the item expires (v19 stores a `time_t` here).
   * 0 / unset = no timer (the common case). When non-zero, the CItemElem
   * serializer writes this DWORD then a conditional remaining-seconds field
   * (`m_dwKeepTime - now`, ObjSerialize.cpp:69-74). ponytail: the exact wire
   * width of the conditional (time_t = 4 vs 8 bytes) needs confirming against
   * the v19 CAr overload when the first timed item actually ships.
   */
  keepTime?: number;
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
   * Within-level experience (mirrors C++ `m_nExp1`): progress toward the next
   * level, 0 at each level boundary. On level-up the consumed portion is
   * subtracted and any excess carries over (see `combat/formulas.addExp`). The
   * DB `exp` column and the SETEXPERIENCE wire field store THIS value -- there
   * is no cumulative form. Per-level threshold is `EXP_TABLE[level+1].nExp1`.
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
   * Active 1v1 duel peer (C++ `m_idDuelOther`, Mover.h). `NULL_ID` = not
   * dueling. Set by `DuelService.accept` on mutual consent; cleared on death,
   * decline, expire, or disconnect. Drives `DUELCANCEL` broadcast on lethal
   * blow + the dual `SETDUEL(nDuel=0)` clear. v1 party-duel variant deferred
   * (ponytail: `m_idDuelParty`).
   */
  m_idDuelTarget: number = NULL_ID;
  /**
   * Party id this player belongs to (C++ `m_idParty` / `CParty::m_uPartyId`),
   * or {@link NULL_ID} when solo. Roster lives in `PartyManager`; this is the
   * per-player back-reference the loot-share + party-chat paths key on.
   */
  m_idParty: number = NULL_ID;
  /**
   * Duel active flag (C++ `m_nDuel`). 0 = idle, 1 = active. Mirrors the C++
   * field the client reads via `OnSetDuel` (DPClient.cpp:15493). Set alongside
   * {@link m_idDuelTarget}; cleared together.
   */
  m_nDuel: number = 0;
  /**
   * Walk-to-object arrival range (C++ `CMover::m_fArrivalRange`). Set alongside
   * `m_idDestObj` by PLAYERSETDESTOBJ; echoed back by QUERYGETDESTOBJ replies.
   */
  m_fArrivalRange: number = 0;
  /**
   * Player-killer / chaotic disposition (C++ `m_dwPKPropensity`, Mover.h:1227 --
   * `IsChaotic()` = `> 0`). Gates guard attackability. Hydrated from the DB on
   * JOIN (`characters.pk_propensity`); mutated on player-kill and PK decay.
   */
  m_dwPKPropensity: number = 0;
  /**
   * PK value / slaughter count (C++ `m_nSlaughter`). Incremented on player-kill.
   * Hydrated from DB on JOIN (`characters.pk_value`).
   */
  m_nPKValue: number = 0;
  /**
   * Wall-clock ms of the last PK action (C++ `m_dwPKTime`, `Date.now()`).
   * Drives PK-value decay. Hydrated from DB on JOIN (`characters.pk_time`).
   */
  m_dwPKTime: number = 0;
  /**
   * PK experience (C++ `m_dwPKExp`). Counter-decay accumulator. Hydrated from
   * DB on JOIN (`characters.pk_exp`).
   */
  m_dwPKExp: number = 0;
  /**
   * PK mode toggle -- transient, per-session, NOT persisted. When true, the
   * player's attacks become PvP-enabled (can target + damage other players).
   * Defaults off; toggled via `PACKETTYPE_MODE` (`CHANGE_PKMODE` branch).
   */
  m_bPKMode: boolean = false;
  /** Last SCRIPTDLG tick (C++ `m_tickScript`) -- 400ms rate limit (DPSrvr.cpp:903). */
  m_tickScript: number = 0;
  /**
   * Last NPC_BUFF tick -- rate limit for the buff-pang packet (C++ `OnNPCBuff`
   * has none; we add a 1s floor to keep a spamming client from DDoS-ing the
   * buff apply loop). Mirrors {@link m_tickScript}.
   */
  m_tickNpcBuff: number = 0;
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
   * Mirror of the client's `m_apIndex` (`_Common/Item.h:818`) -- per slot, the
   * `m_dwObjId` the client believes is sitting there. The bag grid renders slot
   * `i` via `GetAt(i) = m_apItem[m_apIndex[i]]`, so a `CREATEITEM` into slot `i`
   * is only visible when its wire `m_dwObjId` equals `m_invIndex[i]`.
   *
   * Identity (`m_invIndex[i] = i`) at JOIN; **drifts** when items cross the
   * bag/equip boundary on the client (`CItemContainer::DoEquip`/`UnEquip`,
   * `Item.h:545/571`) and is NOT reset by `RemoveAtId` (`Item.h:761`) for bag
   * slots. Without tracking this, `addItem` into a slot vacated by an
   * unequipped-then-sold item writes `m_apItem[slot]` while the client still
   * renders `m_apItem[stale_objid]` -> invisible until relog. Mirrors vanilla
   * `CItemContainer::Add` (`Item.h:718-727`) which reads `nId = m_apIndex[i]`
   * for exactly this reason. In-memory only: JOIN re-initializes both sides.
   */
  m_invIndex: Uint32Array = new Uint32Array(INVENTORY_SLOTS);
  /**
   * Bank tabs (C++ `m_Bank[3]`, 42 slots each). Per-character in v19. Hydrated
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
  /**
   * Action-slot queue (C++ `m_playTaskBar.m_aSlotQueue[MAX_SLOT_QUEUE]`) -- the
   * 5-slot skill chain the client fires in sequence via the action slot UI.
   * Populated by `PACKETTYPE_SKILLTASKBAR`; persisted alongside `m_aSlotItem`
   * in `characters.taskbar` (encode v2); hydrated on JOIN and repushed via the
   * queue section of `SNAPSHOTTYPE_TASKBAR`. END_SKILLQUEUE only signals cast
   * cancel/exhaustion -- it does not mutate this array.
   */
  m_aSlotQueue: Shortcut[] = emptySkillQueue();
  /**
   * Active action-slot queue position (C++ `m_playTaskBar.m_nUsedSkillQueue`).
   * -1 = no queue running; 0..MAX_SLOT_QUEUE-1 = currently-executing slot. Set
   * to 0 on a successful `SUT_QUEUESTART` cast, incremented by the skill
   * service's `advanceQueue` (port of C++ `SetNextSkill`,
   * `UserTaskBar.cpp:203`) after each skill resolves, reset to -1 on queue
   * exhaust or `END_SKILLQUEUE` cancel. Drives server-side combo progression.
   */
  m_nUsedSkillQueue: number = -1;
  /**
   * Action point (C++ `m_playTaskBar.m_nActionPoint`, 0..100). Gates how many
   * queue slots chain: pos 1 costs 6 AP, 2 costs 8, 3 costs 11, 4 costs 30
   * (`UserTaskBar.cpp:211` switch). Defaults to the 100 cap so a fresh logon
   * can full-combo. ponytail: no AP regen tick (C++ `Mover.cpp:3417` regens
   * ~+2/s while active); add when live action-slot pacing matters.
   */
  m_nActionPoint: number = 100;
  /**
   * Pending action-slot queue step timer. Set by `SkillService` when a queued
   * skill is scheduled (the combo is spaced one cast per tick-window so the
   * client's cast animation + `REQ_USESKILL` flag clear before the next fires
   * and before the terminal `ENDSKILLQUEUE` ack). Cleared on queue exhaust,
   * `END_SKILLQUEUE` cancel, or when the scheduled callback finds the player
   * no longer live. ponytail: a per-tick `ActionSlotSystem` would own this
   * instead of a raw timer on the entity.
   */
  m_queueTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  /**
   * Logout penalty deadline (ms epoch) -- C++ `m_dwLeavePenatyTime`. Set by
   * REQ_LEAVE (0x00ff00fa) to `Date.now() + TIMEWAIT_CLOSE*1000` (10s). Idempotent
   * (only set if 0). 0 = no leave requested. The actual disconnect is driven by
   * the LEAVE handler; this timestamp is the deferred-destroy deadline for the
   * safe-zone / guild-war logout penalty path. ponytail: no penalty enforcement
   * yet -- LEAVE destroys immediately; consult this field when porting penalty.
   */
  m_dwLeavePenatyTime: number = 0;
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
   * DST destination-parameter adjustments (C++ `m_adjParamAry`/`m_chgParamAry`,
   * `MoverParam.cpp`). Holds equip +stat bonuses (ring +STR, armor +DEF, etc)
   * applied by `EquipService` / `JoinService.SetEquipDstParam`, and (future)
   * buff effects. Read via `getStr/Sta/Dex/Int` + `getMaxHp/Mp/Fp` -- NOT the
   * raw `m_nStr` fields (those omit bonuses). Derived from equipped items, so
   * not persisted; rebuilt on JOIN from the inventory.
   */
  readonly m_params: ParamModel = new ParamModel();
  /**
   * Set-item bonuses currently applied to `m_params` (C++ `SetDestParamSetItem`,
   * `Mover.cpp:8956`). Removed + recomputed on every equip/unequip and re-seeded
   * on JOIN -- set bonuses are a pure function of equipped state, so this cache
   * is just the delta to reverse. Not persisted (rebuilt from the inventory).
   */
  m_setEffects: DstEffect[] = [];
  /**
   * Active timed DST buffs (C++ `CBuffMgr` / `m_buffs`, `_Common/Mover.h:553`).
   * Applies/ reverses effects on `m_params`; expiry driven by the world tick.
   */
  readonly m_buffs: BuffManager = new BuffManager(this.m_params);
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
  /**
   * Per-group consumable cooldown next-allowed timestamps (C++
   * `CCooltimeMgr::m_times[]`, `CooltimeMgr.h`). 1-based group → index
   * `group-1`; `0` = ready. Transient (not persisted -- matches C++).
   * Groups: 1 food, 2 pill, 3 skill, 4 potion (our addition).
   */
  m_cooltime: number[] = new Array(MAX_COOLTIME_GROUP).fill(0);
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
    this.m_nStr = row.strength;
    this.m_nSta = row.stamina;
    this.m_nDex = row.dexterity;
    this.m_nInt = row.intelligence;
    // Max HP/MP/FP are formula-derived (C++ `GetMaxOriginHitPoint`/`ManaPoint`/
    // `FatiguePoint`), NOT the DB cache -- the client computes the same formula
    // and shows that value (e.g. 236), so the server must match or regen clamps
    // against a stale ceiling. FP included so a pre-tick read (JOIN snapshot)
    // sees the right ceiling, not 0. Recomputed each recovery tick too
    // (level-up + equip safe). Must run after STA/INT/job load.
    const job = getJobProps(this.m_nJob);
    this.m_nMaxHp = maxHitPoint(this.m_nLevel, this.m_nSta, job.fFactorMaxHP);
    this.m_nMaxMp = maxManaPoint(this.m_nLevel, this.m_nInt, job.fFactorMaxMP);
    this.m_nMaxFp = maxFatiguePoint(this.m_nLevel, this.m_nSta, job.fFactorMaxFP);
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
    this.m_dwPKPropensity = row.pk_propensity ?? 0;
    this.m_nPKValue = row.pk_value ?? 0;
    this.m_dwPKTime = Number(row.pk_time ?? 0);
    this.m_dwPKExp = row.pk_exp ?? 0;
    this.socket = socket;
    // m_invIndex: identity for the bag range (m_apIndex[i] = i after Clear,
    // Item.h:480), NULL_ID for equip slots (set by syncInvIndexAfterLoad once
    // equipped items are hydrated). Matches the m_apIndex blob writeItemContainer
    // emits at JOIN, so server and client start in sync.
    for (let i = 0; i < INVENTORY_SLOTS; i++) {
      this.m_invIndex[i] = i < MAX_INVENTORY ? i : NULL_ID;
    }
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
   * Seed the job-skill roster IDs from a job-ordered skill-id list, mirroring
   * C++ `CMover::CreateMover` which fills `m_aJobSkill[i].dwSkill` from
   * `prj.m_aJobSkill[job]` on every load (`Mover.cpp:1497`). Only skill *levels*
   * are persisted (by slot); the IDs are re-derived each JOIN, so without this
   * the client's skill-tree window scans an all-NULL_ID roster and shows nothing
   * to learn or upgrade. Slots beyond the list keep the NULL_ID sentinel.
   * Levels are applied later via {@link overlaySkillLevels}.
   */
  seedRoster(orderedSkillIds: ReadonlyArray<number>): void {
    for (let i = 0; i < this.m_aJobSkill.length; i++) {
      const id = orderedSkillIds[i];
      this.m_aJobSkill[i] = id !== undefined
        ? { skillId: id, level: 0 }
        : { skillId: NULL_ID, level: 0 };
    }
  }

  /**
   * Overlay persisted learned levels onto the seeded roster, matched by skillId
   * (not slot) so a change in seed order across versions never mislabels a
   * level. Unmatched entries are dropped defensively.
   */
  overlaySkillLevels(learned: ReadonlyArray<{ skillId: number; level: number }>): void {
    for (const l of learned) {
      if (l.skillId === NULL_ID || l.skillId === 0 || l.level <= 0) continue;
      const slot = this.m_aJobSkill.find((s) => s.skillId === l.skillId);
      if (slot) slot.level = l.level;
    }
  }

  /** C++ `IsChaotic()` (Mover.h:1227) -- player-killer state (PK). */
  isChaotic(): boolean {
    return this.m_dwPKPropensity > 0;
  }

  /** True if a stun/sleep status bit is set in the DST_CHRSTATE pool (cannot act). */
  isStunned(): boolean {
    const state = this.m_params.get(DST.CHRSTATE, 0);
    return (state & (CHRSTATE_BITS.STUN | CHRSTATE_BITS.SLEEP)) !== 0;
  }

  /**
   * Find the current slot of the inventory item whose stable `objid` matches.
   * The client addresses items by `m_dwObjId` (stable; set at JOIN = slot index,
   * preserved across equip/unequip/move). Our flat `m_Inventory` is indexed by
   * slot, so a moved item's objid != its current slot -- callers must resolve via
   * this scan, never treat the wire objid as a slot (breaks after first move).
   * Mirrors C++ `m_apItem[objid]` being the stable array (Item.h:515 GetAtId).
   * Falls back to treating `objid` as a slot for items without a tracked objid.
   */
  findSlotByObjId(objid: number): number {
    for (let i = 0; i < INVENTORY_SLOTS; i++) {
      const s = this.m_Inventory[i];
      if (s && s.objid === objid) return i;
    }
    if (objid >= 0 && objid < INVENTORY_SLOTS && this.m_Inventory[objid]) return objid;
    return -1;
  }

  // --- m_invIndex maintenance (mirror of client m_apIndex) -------------------
  // Keep server tracking of m_apIndex in lockstep with the client's
  // CItemContainer mutations so addItem() can pick the objid the client expects
  // for a given slot. See the m_invIndex field doc above.

  /** The `m_dwObjId` the client currently holds for `slot` (= its `m_apIndex[slot]`). */
  clientObjId(slot: number): number {
    return this.m_invIndex[slot] ?? slot;
  }

  /**
   * After `JoinService.loadInventory` hydrates equipped slots: set the equip
   * range of `m_invIndex` to match the JOIN container blob (slot = occupied ->
   * `m_apIndex[slot] = slot`; empty -> `NULL_ID`). Bag range is already identity
   * from the constructor.
   */
  syncInvIndexAfterLoad(): void {
    for (let s = MAX_INVENTORY; s < INVENTORY_SLOTS; s++) {
      this.m_invIndex[s] = this.m_Inventory[s] ? s : NULL_ID;
    }
  }

  /**
   * Equip move (bag `srcSlot` -> equip `dstSlot`): mirror `CItemContainer::DoEquip`
   * (`Item.h:545`). The equip slot takes the bag slot's prior objid; the now-empty
   * bag slot takes a fresh free objid (the first `m_apItem` index not used by any
   * occupied slot). Idempotent against the prior occupant: callers handle the
   * swap separately; this only tracks the primary bag->equip relocation.
   */
  onEquipIndexMove(srcSlot: number, dstSlot: number): void {
    this.m_invIndex[dstSlot] = this.m_invIndex[srcSlot] ?? srcSlot;
    this.m_invIndex[srcSlot] = this.firstFreeObjId();
  }

  /**
   * Unequip move (equip `srcSlot` -> bag `dstSlot`): mirror `CItemContainer::UnEquip`
   * (`Item.h:571`). The bag slot takes the equip slot's prior objid (the item's
   * stable m_dwObjId); the equip slot is cleared. This is the drift that leaves
   * `m_apIndex[dstSlot]` pointing at the stale equip objid after the item is
   * later sold -- exactly what addItem() must match.
   */
  onUnequipIndexMove(srcSlot: number, dstSlot: number): void {
    this.m_invIndex[dstSlot] = this.m_invIndex[srcSlot] ?? srcSlot;
    this.m_invIndex[srcSlot] = NULL_ID;
  }

  /** MOVEITEM pure swap: mirror `CItemContainer::Swap` -- swap both slots' objids. */
  onInvSlotsSwapped(a: number, b: number): void {
    const tmp = this.m_invIndex[a];
    this.m_invIndex[a] = this.m_invIndex[b];
    this.m_invIndex[b] = tmp ?? b;
  }

  /**
   * Smallest objid in `[0, INVENTORY_SLOTS)` not used by any occupied slot --
   * mirrors the `m_apItem[i].IsEmpty()` scan in `CItemContainer::DoEquip`
   * (`Item.h:555-567`). Used to assign a fresh placeholder when a bag slot is
   * vacated by equipping out of it.
   */
  private firstFreeObjId(): number {
    const used = new Set<number>();
    for (let s = 0; s < INVENTORY_SLOTS; s++) {
      if (this.m_Inventory[s]) used.add(this.m_invIndex[s] ?? s);
    }
    for (let o = 0; o < INVENTORY_SLOTS; o++) if (!used.has(o)) return o;
    return NULL_ID;
  }

  // --- DST-adjusted primary-stat + vital-max readers (`MoverParam.cpp`) ---
  // Use these wherever equip/buff bonuses must count -- raw `m_nStr` etc omit
  // the DST adjustments in `m_params`. `getStr()` = `m_nStr + DST_STR`, floored
  // at 1 (C++ `__JEFF_11`, `MoverParam.cpp:3163`). `getMaxHp()` wraps the origin
  // formula with `DST_HP_MAX` (flat) + `DST_HP_MAX_RATE` (%) (`GetMaxHitPoint`,
  // `MoverParam.cpp:2788`).

  /** `CMover::GetStr` (`MoverParam.cpp:3163`). */
  getStr(): number { return Math.max(1, this.m_nStr + this.m_params.get(DST.STR, 0)); }
  /** `CMover::GetSta` (`MoverParam.cpp:3226`). */
  getSta(): number { return Math.max(1, this.m_nSta + this.m_params.get(DST.STA, 0)); }
  /** `CMover::GetDex` (`MoverParam.cpp:3184`). */
  getDex(): number { return Math.max(1, this.m_nDex + this.m_params.get(DST.DEX, 0)); }
  /** `CMover::GetInt` (`MoverParam.cpp:3205`). */
  getInt(): number { return Math.max(1, this.m_nInt + this.m_params.get(DST.INT, 0)); }

  /** Current job props (`prj.GetJobProp(GetJob())`). */
  jobProps(): JobProps { return getJobProps(this.m_nJob); }

  /**
   * Per-job-type level cap -- mirrors C++ `AddExperience` (`MoverParam.cpp:1224`):
   * `IsBaseJob` (Vagrant, `JTYPE_BASE`, job 0) caps at `MAX_JOB_LEVEL` (15);
   * `IsExpert` (1st job, `JTYPE_EXPERT`, jobs 1-5) caps at
   * `MAX_JOB_LEVEL + MAX_EXP_LEVEL` (60); `IsPro`+ (2nd job onward) uses the
   * global cap. At/above this level the player cannot gain exp (C++ clamps
   * `m_nExp1 = 0`). The Vagrant cap is the level-gate for the first job change.
   */
  jobLevelCap(): number {
    if (this.m_nJob === 0) return MAX_JOB_LEVEL; // JOB_VAGRANT / JTYPE_BASE
    if (this.m_nJob <= 5) return MAX_JOB_LEVEL + MAX_EXP_LEVEL; // JTYPE_EXPERT
    return MAX_LEVEL; // JTYPE_PRO and above
  }

  /**
   * `CMover::GetMaxHitPoint` (`MoverParam.cpp:2788`): origin (STA-derived) base,
   * then `DST_HP_MAX` flat override/add, then `DST_HP_MAX_RATE` % multiplier.
   * Floors at 1.
   */
  getMaxHp(): number {
    const origin = maxHitPoint(this.m_nLevel, this.getSta(), this.jobProps().fFactorMaxHP);
    const base = this.m_params.get(DST.HP_MAX, origin);
    return Math.max(1, Math.floor(base * (1 + this.m_params.get(DST.HP_MAX_RATE, 0) / 100)));
  }

  /** `CMover::GetMaxManaPoint` (`MoverParam.cpp:2808`). INT-derived. */
  getMaxMp(): number {
    const origin = maxManaPoint(this.m_nLevel, this.getInt(), this.jobProps().fFactorMaxMP);
    const base = this.m_params.get(DST.MP_MAX, origin);
    return Math.max(1, Math.floor(base * (1 + this.m_params.get(DST.MP_MAX_RATE, 0) / 100)));
  }

  /** `CMover::GetMaxFatiguePoint` (`MoverParam.cpp:2825`). STA-derived. */
  getMaxFp(): number {
    const origin = maxFatiguePoint(this.m_nLevel, this.getSta(), this.jobProps().fFactorMaxFP);
    const base = this.m_params.get(DST.FP_MAX, origin);
    return Math.max(1, Math.floor(base * (1 + this.m_params.get(DST.FP_MAX_RATE, 0) / 100)));
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

/**
 * CMover -- live in-world NPC/monster entity.
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

import type { Vec3, InventorySlot } from './player';
import { ParamModel, EMPTY_PARAM_VIEW } from './params/ParamModel';
import { BuffManager } from './params/BuffManager';
import { DST, CHRSTATE_BITS } from './constants/dst';
import {
  MELEE_ATTACK_RANGE, RANGE_ATTACK_RANGE, REATTACK_DELAY_MS, BELLI_RANGE_KEYS,
  ACTIVE_BELLI, RUNAWAY_DELAY_MS,
} from './constants/aiConstants';

/** `NULL_ID` (`_Network/MsgHdr.h` = 0xffffffff) -- "no target" sentinel for `m_idTarget`. */
const NULL_ID = 0xffffffff;

/** One equipped part -- C++ `m_Inventory.GetEquip(uParts)` iteration output. */
export interface MoverEquipPart {
  /** `uParts` (u_char) -- body slot, PARTS_* from defineNeuz.h:26-35. */
  readonly parts: number;
  /** `m_dwItemId` (u_short) -- propItem id (low 16 bits). */
  readonly itemId: number;
}

/**
 * Human-NPC outfit -- C++ `character.inc` `SetFigure` + `SetEquip`
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

/**
 * Resolved NPC vendor shop stock -- 4 tabs (`MAX_VENDOR_INVENTORY_TAB`), each a
 * 100-wide slot array (`MAX_VENDOR_INVENTORY`) passed straight to the shop
 * `CItemContainer<CItemElem>` serializer. Built once per NPC at boot from the
 * `character.inc` block's `AddVendorItem`/`AddVendorItem2` entries; an all-null
 * tab serializes identically to the empty container. Slot shape reuses
 * {@link InventorySlot} (each entry `count: 1`; NPC shops are infinite).
 */
export type VendorStock = readonly (readonly (InventorySlot | null)[])[];

/** 4 tabs of 100 nulls -- the default for monsters/NPCs with no vendor block. */
export const EMPTY_VENDOR_STOCK: VendorStock = Object.freeze(
  Array.from({ length: 4 }, () => Object.freeze(Array.from({ length: 100 }, () => null))),
) as VendorStock;

/** Fields required to spawn a monster instance (from a spawn definition). */
export interface MoverSpawnSource {
  /** propMover row index (MI_* define) -> `dwObjIndex` / `m_dwIndex`. */
  readonly modelIndex: number;
  /** Symbolic `MI_*` name (defineObj.h) -> resolves NPC dialog prefix. Omit for monsters. */
  readonly key?: string | undefined;
  /**
   * character.inc block key (e.g. `MaFl_Marche`) -> sent as `m_szCharacterKey` so
   * the client resolves its own `CNpcProperty` (which carries `m_abMoverMenu`
   * from AddMenu). Decoupled from {@link outfit}: an NPC may have AddMenu but no
   * SetFigure/SetEquip. Omit for monsters.
   */
  readonly characterKey?: string | undefined;
  readonly level: number;
  readonly hp: number;
  readonly name: string;
  /** Model scale (1.0 default); written as `m_vScale.x * 100`. */
  readonly scale?: number | undefined;
  /** Human-NPC outfit (character.inc SetFigure/SetEquip). Omit for monsters. */
  readonly outfit?: MoverOutfit | undefined;
  /** character.inc AddMenu ids (MMI_*). Empty for monsters (no block). */
  readonly menus?: readonly number[] | undefined;
  /**
   * Resolved vendor shop stock (4 tabs). Built by `SpawnManager` from the
   * character.inc block; defaults to {@link EMPTY_VENDOR_STOCK} when absent.
   */
  readonly vendorStock?: VendorStock | undefined;
  /** C++ `bKillable` + peaceful flag collapsed -- may be targeted for attack. */
  readonly attackable?: boolean | undefined;
  /** C++ `RANK_GUARD` -- town guard; PK-gated attackability. */
  readonly guard?: boolean | undefined;
  /**
   * `MI_CHAOGUARDIAN` inverse guard (propMover `dwKarma == -2000`) -- attackable
   * only by *non*-chaotic players (opposite of {@link guard}). Rare; omit for all
   * ordinary movers.
   */
  readonly chaoGuard?: boolean | undefined;
  /**
   * C++ `m_dwBelligerence` (defineAttribute.h:203-215). 1 = BELLI_PEACEFUL
   * (suppresses client attack cursor); 11/12/13 = aggressive. 0 = unspecified.
   */
  readonly belligerence?: number | undefined;
  /**
   * Combat stats (propMover cols). Populated by `SpawnManager` from the mover
   * definition. ponytail: yml `attack` is a single field -- split into raw
   * `dwAtkMin/Max` when the resources converter exports them separately.
   */
  readonly atkMin?: number | undefined;
  readonly atkMax?: number | undefined;
  /** `dwNaturalArmor` (propMover col 35) -- NPC melee DEF source. */
  readonly armor?: number | undefined;
  /** `dwHR` (col 6) -- NPC hit rate. */
  readonly hr?: number | undefined;
  /** `dwER` (col 7) -- NPC parrying / evasion. */
  readonly er?: number | undefined;
  /** `nExpValue` (col 58) -- base exp granted on kill. */
  readonly expValue?: number | undefined;
  /** propMover `fSpeed` (col 44) -- per-sub-step walk distance; 0 = stationary. */
  readonly speed?: number | undefined;
  /**
   * Attack distance (m) -- yml `attack_range`. Melee contact when omitted; ranged
   * monsters (belli `*_RANGE`) shoot from here. C++ derives this from the weapon
   * `dwAttackRange` enum (`MoverMsg.cpp:140-166`); we take the yml value directly.
   */
  readonly attackRange?: number | undefined;
  /**
   * Re-attack delay (ms) -- yml `attack_speed` (propMover `dwReAttackDelay`,
   * col 31). Base cooldown between melee swings; ranged uses a fixed 3 s.
   */
  readonly reAttackDelay?: number | undefined;
  /**
   * Flee HP percentage (0-100) -- propMoverEx `SetRunAway(HP%)` AI block
   * (`AIMonster.cpp` `StateRunaway`). When this monster's HP drops to/below
   * this percent of max, it drops its target and runs AWAY from the attacker
   * for `runawayDelay` ms, then returns home. Absent/0 = never flees
   * (faithful: only `SetRunAway`-tagged mobs flee; the v19 Flaris field set
   * has no such tag, so by default nothing flees).
   */
  readonly fleeHpPct?: number | undefined;
  /**
   * Runaway duration (ms) -- propMoverEx `m_dwRunawayDelay` (template default
   * 1000). How long the monster flees before transitioning to return-home.
   * Defaults to {@link RUNAWAY_DELAY_MS}.
   */
  readonly runawayDelay?: number | undefined;
  /**
   * Self-heal HP percentage (0-100) -- propMoverEx `Recovery(HP%)` AI block
   * (`AIMonster.cpp` `MoveProcessStand` recvCond check). When this monster's
   * HP drops to/below this percent of max, it heals itself for `healAmount`
   * every `healCadenceMs` ms. Absent/0 = never self-heals (faithful: only
   * `Recovery`-tagged mobs heal; the v19 Flaris field set has no such tag).
   */
  readonly healHpPct?: number | undefined;
  /**
   * Self-heal amount (HP restored per tick) when the heal threshold is met.
   * Defaults to 10% of max HP per tick (C++ `m_nRecvCondMe` is a percent of
   * max HP; typical value 10-20%).
   */
  readonly healAmount?: number | undefined;
  /**
   * Self-heal cadence (ms) -- how often the healer AI ticks. C++ checks
   * recvCond every `ProcessAI` tick (~1 s). Defaults to 1000 ms.
   */
  readonly healCadenceMs?: number | undefined;
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
  /**
   * character.inc block key (e.g. `MaFl_Marche`). Serialized as
   * `m_szCharacterKey` in the NPC ADD_OBJ branch so the client can look up its
   * own `CNpcProperty` -> `m_abMoverMenu` (AddMenu flags). Empty for monsters.
   * Distinct from {@link m_szKey} (which is the `MI_*` form).
   */
  m_szCharacterKey: string;
  m_szName: string;
  m_nLevel: number;
  /** Current HP (C++ `m_nHitPoint`). */
  m_nHitPoint: number;
  m_nMaxHitPoint: number;
  m_vPos: Vec3;
  /**
   * Spawn anchor -- C++ `CAIMonster::m_vPosBegin` (`AIMonster.cpp:127-132`), set
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
  /**
   * Aggro-on-sight flag (C++ `m_bActiveAttack`) -- the red-name gate.
   * `AIMonster.cpp:429` sight-acquires only when this is set, and
   * `MoverRender.cpp:1448` renders the name red when `!IsPeaceful() && this`.
   * Derived from belli: true only for the `ACTIVEATTACK*` bells {3,5,6,7}
   * (`ACTIVE_BELLI`). `BELLI_MELEE2X/MELEE/RANGE` (11/12/13) are cautious-type
   * (counterattack WHEN attacked) -> NOT red, NOT sight-aggro -- they retaliate
   * via `triggerRage` on the damage path instead.
   */
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
  /** C++ `bKillable` + peaceful flag collapsed -- may be targeted for attack. */
  m_bAttackable: boolean;
  /** C++ `RANK_GUARD` -- town guard; only chaotic/PK players may attack. */
  m_bGuard: boolean;
  /** `MI_CHAOGUARDIAN` inverse guard -- only NON-chaotic players may attack. */
  m_bChaoGuard: boolean;
  /** Human-NPC outfit (character.inc). Undefined for monsters -> naked spawn. */
  readonly outfit?: MoverOutfit | undefined;
  /** character.inc AddMenu ids (MMI_*). Carries dialog/trade/bank capability. */
  readonly menus?: readonly number[] | undefined;
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
  /**
   * Attack distance (m) -- the gate radius for the AI swing check. Melee contact
   * (~3 m) or ranged (`attack_range`, default `AR_RANGE` 10 m). C++ source is
   * the weapon `dwAttackRange` enum (`MoverMsg.cpp:140-166`).
   */
  m_nAttackRange: number;
  /** Base melee re-attack delay (ms) -- propMover `dwReAttackDelay` (col 31). */
  m_nReAttackDelay: number;
  /**
   * Ranged attacker -- derived from belligerence `*_RANGE` (7/10/13). Such
   * monsters shoot from `m_nAttackRange` on a fixed 3 s cadence and broadcast
   * `SNAPSHOTTYPE_RANGE_ATTACK` instead of `MELEE_ATTACK`.
   */
  m_bRangeAttack: boolean;
  /** Combat death flag -- set on lethal damage; swept from the spawn map on tick. */
  m_bDead: boolean = false;
  /**
   * Fleeing (C++ `m_bRunaway`) -- running AWAY from the attacker at chase
   * speed; expires after `m_tmRunawayEnd` -> transition to return-home.
   */
  m_bRunaway: boolean = false;
  /** Timestamp (ms, `Date.now()`) when the current runaway expires -> return-home. */
  m_tmRunawayEnd: number = 0;
  /**
   * Flee HP threshold -- 1-100 (% of max). Populated from `MoverSpawnSource.fleeHpPct`
   * (propMoverEx `SetRunAway`). Undefined/0 = never flees.
   */
  m_nFleeHpPct: number = 0; // % -> when `100*HP/maxHP <= this` -> flee
  /**
   * Flee duration (ms) before returning home. Populated from `MoverSpawnSource.runawayDelay`
   * (propMoverEx `m_dwRunawayDelay`, default 1000).
   */
  m_nRunawayDelay: number = RUNAWAY_DELAY_MS;
  /**
   * Self-heal HP threshold -- 1-100 (% of max). Populated from
   * `MoverSpawnSource.healHpPct` (propMoverEx `Recovery` block). 0 = never.
   */
  m_nHealHpPct: number = 0;
  /** Self-heal HP amount per tick (flat HP). Populated from `MoverSpawnSource.healAmount`. */
  m_nHealAmount: number = 10;
  /** Self-heal cadence (ms). Populated from `MoverSpawnSource.healCadenceMs` (default 1000). */
  m_nHealCadenceMs: number = 1000;
  /** Timestamp (ms, `Date.now()`) when the next self-heal tick fires. 0 = uninitialized. */
  m_tmNextHealTick: number = 0;
  /** DST destination-parameter pool (single `Int32Array(94)` adj + chg arrays). */
  readonly m_params: ParamModel = new ParamModel();
  /** Active timed DST buffs on this mover (debuffs from player skills). */
  readonly m_buffs: BuffManager = new BuffManager(this.m_params);

  /** True if the stun bit is set in the DST_CHRSTATE pool (cannot act). */
  isStunned(): boolean {
    return (this.m_params.get(DST.CHRSTATE, 0) & CHRSTATE_BITS.STUN) !== 0;
  }
  /**
   * Timestamp (ms, `Date.now()`) when this mover next picks an idle-wander
   * destination. `0` = uninitialized -> the AI stagger-seeds it on first tick.
   * C++ drives this from `m_tmMove` + `SEC(5)+xRandom(SEC(1))` on arrival.
   */
  m_tmNextWander: number = 0;
  /**
   * Current aggro target objid (C++ `CAIMonster::m_dwIdTarget`, `AIMonster.h:37`).
   * `NULL_ID` = idle. Set on sight (active BELLI) or on damage (`AIMSG_DAMAGE`,
   * `AIMonster.cpp:485`). Single slot -- no aggro list (ponytail: full table).
   */
  m_idTarget: number = NULL_ID;
  /** Position when first damaged (C++ `m_vPosDamage`) -- 120 m pursuit leash origin. */
  m_vPosDamage: Vec3;
  /** Current walk destination (C++ `GetDestPos()`) -- idle pick, pursue target, or home. */
  m_vDestPos: Vec3;
  /** propMover `fSpeed` -- per-sub-step distance; the AI stepper scales it into u/s. */
  m_fSpeedBase: number;
  /** Leashing home (C++ `m_bReturnToBegin`) -- run to anchor at 2.66*, restore HP, drop target. */
  m_bReturnToBegin: boolean = false;
  /** Timestamp (ms) the current return-home began -- feeds the stuck-teleport gate. */
  m_tmReturnToBegin: number = 0;
  /** Chase-window expiry (C++ `m_tmAttack`, `s_tmAttack = SEC(15)`) -- anti-stuck gate. */
  m_tmAttack: number = 0;
  /**
   * Hit-share table for kill exp (`m_idEnemies`). OBJID -> cumulative damage.
   * v1: single-attacker (no party grouping). ponytail: full HIT_INFO + party.
   */
  readonly m_idEnemies = new Map<number, number>();
  /**
   * character.inc `m_abMoverMenu` (Project.cpp:3024) -- MMI_* ids enabled via
   * `AddMenu`/`AddMenuLang`. `MMI_DIALOG = 0` presence gates the right-click
   * "Dialog" option -> SCRIPTDLG. Empty for monsters (no character.inc block).
   * Source: `defineNeuz.h:92-314`.
   */
  readonly m_abMoverMenu: readonly number[] = [];
  /**
   * Resolved vendor shop stock (character.inc `AddVendorItem`/`AddVendorItem2`).
   * 4 tabs of 100 slots; read by `ShopService.open` and serialized by
   * `buildOpenShopWnd`. Defaults to {@link EMPTY_VENDOR_STOCK} for monsters.
   */
  readonly m_vendorStock: VendorStock = EMPTY_VENDOR_STOCK;

  private constructor(
    id: number,
    src: MoverSpawnSource,
    pos: Vec3,
    zoneId: number,
  ) {
    this.m_idMover = id;
    this.m_dwIndex = src.modelIndex;
    this.m_szKey = src.key ?? '';
    this.m_szCharacterKey = src.characterKey ?? '';
    this.m_szName = src.name;
    this.m_nLevel = src.level;
    this.m_nHitPoint = src.hp;
    this.m_nMaxHitPoint = src.hp;
    this.m_vPos = { ...pos };
    this.m_vPosBegin = { ...pos };
    this.m_vPosDamage = { ...pos };
    this.m_vDestPos = { ...pos };
    this.m_fSpeedBase = src.speed ?? 0;
    this.m_fAngle = 0;
    this.m_vScale = src.scale ?? 1.0;
    this.m_nZoneId = zoneId;
    this.m_dwBelligerence = src.belligerence ?? 0;
    this.m_bActiveAttack = ACTIVE_BELLI.has(this.m_dwBelligerence) ? 1 : 0;
    this.m_fSpeedFactor = 1.0;
    this.m_bAttackable = src.attackable ?? true;
    this.m_bGuard = src.guard ?? false;
    this.m_bChaoGuard = src.chaoGuard ?? false;
    this.outfit = src.outfit;
    this.m_abMoverMenu = src.menus ?? [];
    this.m_vendorStock = src.vendorStock ?? EMPTY_VENDOR_STOCK;
    this.m_nAtkMin = src.atkMin ?? 0;
    this.m_nAtkMax = src.atkMax ?? src.atkMin ?? 0;
    this.m_nArmor = src.armor ?? 0;
    this.m_nHR = src.hr ?? 0;
    this.m_nER = src.er ?? 0;
    this.m_nExpValue = src.expValue ?? 0;
    this.m_nElement = 0;
    this.m_bRangeAttack = BELLI_RANGE_KEYS.has(this.m_dwBelligerence);
    this.m_nAttackRange = src.attackRange ?? (this.m_bRangeAttack ? RANGE_ATTACK_RANGE : MELEE_ATTACK_RANGE);
    this.m_nReAttackDelay = src.reAttackDelay ?? REATTACK_DELAY_MS;
    this.m_nFleeHpPct = Math.max(0, Math.min(100, src.fleeHpPct ?? 0));
    this.m_nRunawayDelay = src.runawayDelay ?? RUNAWAY_DELAY_MS;
    this.m_nHealHpPct = Math.max(0, Math.min(100, src.healHpPct ?? 0));
    this.m_nHealAmount = Math.max(1, src.healAmount ?? Math.max(1, Math.ceil(this.m_nMaxHitPoint * 0.1)));
    this.m_nHealCadenceMs = Math.max(500, src.healCadenceMs ?? 1000);
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

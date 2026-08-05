/**
 * @flyff/entities -- shared entity layer consumed by every world-server domain.
 *
 * Holds CPlayer/CMover + the value symbols (exp/vitals/Rng math, job table,
 * slot sizing, authority/mode constants, RuntimeQuest) that would otherwise
 * create combat<->entities / world-core<->entities cycles. Depends only on
 * `@flyff/core` (constants) + `@flyff/database` (CharacterRow type).
 *
 * @module @flyff/entities
 */

// Entity classes + their field types
export { CPlayer } from './player';
export type { PlayerSocket, Vec3, SkillSlot, Shortcut, InventorySlot } from './player';
export { CMover, EMPTY_VENDOR_STOCK } from './mover';
export type {
  MoverEquipPart, MoverOutfit, VendorStock, MoverSpawnSource,
} from './mover';

// Constants
export { AUTH, AUTH_VALUES, AUTH_LABELS, toAuthority } from './constants/authority';
export type { Authority } from './constants/authority';
export { hasAuthority } from './constants/authority';
export { MODE } from './constants/mode';
export { OBJSTAF, PARTS_RIDE, FLIGHT_LV_MIN_LEVEL } from './constants/stateFlag';
export {
  MELEE_ATTACK_RANGE, RANGE_ATTACK_RANGE, REATTACK_DELAY_MS, REATTACK_JITTER_MS,
  RANGE_REATTACK_DELAY_MS, RANGE_MOVE, RANGE_RETURN_TO_BEGIN, RAGE_LEASH,
  HOME_ARRIVAL, SIGHT_RANGE, PURSUE_SPEED_FACTOR, RETURN_SPEED_FACTOR,
  FLEE_SPEED_FACTOR, RUNAWAY_DELAY_MS,
  CHASE_WINDOW_MS, RETURN_STUCK_MS, SPEED_SCALE,
  OBJMSG_ATK1, OBJMSG_ATK_RANGE1, OBJMSG_STOP, OBJMSG_DIE,
  II_SYS_SYS_SCR_RESURRECTION, ACTIVE_BELLI, AGGRO_LEVEL_BAND, BELLI_RANGE_KEYS,
} from './constants/aiConstants';
export {
  NULL_ID, MAX_HUMAN_PARTS, MAX_SKILL_JOB, MAX_INVENTORY, MAX_BANK, MAX_BANK_TABS,
  INVENTORY_SLOTS, BANK_SLOTS, MAX_SLOT_ITEM_COUNT, MAX_SLOT_ITEM, MAX_SLOT_QUEUE,
  MAX_SHORTCUT_STRING, SHORTCUT, MAX_SHORTCUT_CHAT,
  MAX_COOLTIME_GROUP, COOLTIME_GROUP,
} from './constants/slots';
export { DST, MAX_ADJPARAMARY, CHG_SENTINEL, CHRSTATE_BITS } from './constants/dst';
export type { DstId } from './constants/dst';
export { AR, getAttackRange, RANGE_HITBOX_SLACK } from './constants/attackRange';
export {
  MAX_CHEERPOINT, TICK_CHEERPOINT_MS, MTI_CHEERSAME, MTI_CHEEROTHER,
  XI_CHEERSENDEFFECT, XI_CHEERRECEIVEEFFECT, II_CHEERUP, CHEERUP_DURATION_MS,
  TID_CHEER_MESSAGE3, TID_CHEER_MESSAGE4, TID_CHEER_NO1, TID_CHEER_NO2,
} from './constants/cheer';

// DST parameter model (equip + future buffs)
export { ParamModel, EMPTY_PARAM_VIEW } from './params/ParamModel';
export type { ParamView, DstEffect } from './params/ParamModel';
export {
  VTInfo, MAX_TRADE, TRADE_STEP,
  MAX_VENDITEM, MAX_VENDOR_REVISION, MAX_VENDORNAME,
  TID_GAME_CANNOTTRADE_ITEM, TID_GAME_CANNOT_DO_USINGITEM,
} from './params/VTInfo';
export type { TradeStake, TradeStep, VendorListing } from './params/VTInfo';
export { BuffManager, BUFF_SKILL, BUFF_ITEM, MAX_SKILL_BUFF } from './params/BuffManager';
export type { ActiveBuff, AddBuffOutcome, DoTPayload } from './params/BuffManager';

// Math
export { EXP_TABLE, MAX_LEVEL, MAX_JOB_LEVEL, MAX_EXP_LEVEL } from './math/expTable';
export type { ExpRow } from './math/expTable';
export type { Rng } from './math/rng';
export { xRandomRng } from './math/rng';
export {
  expLevelDiffMult, expPartyReduceFactor, expToNextLevel, addExp, subDieDecExp,
} from './math/exp';
export type { ExpGainResult } from './math/exp';
export {
  maxHitPoint, maxManaPoint, maxFatiguePoint, standRecovery,
} from './math/vitals';
export type { RecoveryAmount } from './math/vitals';

// Tables
export { JOB_TABLE, JOB_VAGRANT, getJobProps } from './tables/job';
export type { JobProps } from './tables/job';
export { isJobMatch } from './tables/jobLineage';

// State
export type { RuntimeQuest } from './state/quest';

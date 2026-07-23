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
export { AUTH } from './constants/authority';
export type { Authority } from './constants/authority';
export { hasAuthority } from './constants/authority';
export { MODE } from './constants/mode';
export {
  MELEE_ATTACK_RANGE, RANGE_ATTACK_RANGE, REATTACK_DELAY_MS, REATTACK_JITTER_MS,
  RANGE_REATTACK_DELAY_MS, RANGE_MOVE, RANGE_RETURN_TO_BEGIN, RAGE_LEASH,
  HOME_ARRIVAL, SIGHT_RANGE, PURSUE_SPEED_FACTOR, RETURN_SPEED_FACTOR,
  CHASE_WINDOW_MS, RETURN_STUCK_MS, SPEED_SCALE,
  OBJMSG_ATK1, OBJMSG_ATK_RANGE1, OBJMSG_STOP, OBJMSG_DIE,
  II_SYS_SYS_SCR_RESURRECTION, ACTIVE_BELLI, AGGRO_LEVEL_BAND, BELLI_RANGE_KEYS,
} from './constants/aiConstants';
export {
  NULL_ID, MAX_HUMAN_PARTS, MAX_SKILL_JOB, MAX_INVENTORY, MAX_BANK, MAX_BANK_TABS,
  INVENTORY_SLOTS, BANK_SLOTS, MAX_SLOT_ITEM_COUNT, MAX_SLOT_ITEM,
  MAX_SHORTCUT_STRING, SHORTCUT, MAX_SHORTCUT_CHAT,
  MAX_COOLTIME_GROUP, COOLTIME_GROUP,
} from './constants/slots';
export { DST, MAX_ADJPARAMARY, CHG_SENTINEL } from './constants/dst';
export type { DstId } from './constants/dst';

// DST parameter model (equip + future buffs)
export { ParamModel, EMPTY_PARAM_VIEW } from './params/ParamModel';
export type { ParamView, DstEffect } from './params/ParamModel';

// Math
export { EXP_TABLE, MAX_LEVEL } from './math/expTable';
export type { ExpRow } from './math/expTable';
export type { Rng } from './math/rng';
export { xRandomRng } from './math/rng';
export {
  expLevelDiffMult, expToNextLevel, addExp, subDieDecExp,
  withinLevelExp, cumulativeExp,
} from './math/exp';
export type { ExpGainResult } from './math/exp';
export {
  maxHitPoint, maxManaPoint, maxFatiguePoint, standRecovery,
} from './math/vitals';
export type { RecoveryAmount } from './math/vitals';

// Tables
export { JOB_TABLE, JOB_VAGRANT, getJobProps } from './tables/job';
export type { JobProps } from './tables/job';

// State
export type { RuntimeQuest } from './state/quest';

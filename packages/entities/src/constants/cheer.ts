/**
 * Cheer-system constants -- `PACKETTYPE_CHEERING` (0xffffff7c).
 *
 * Mirrors `_Common/Mover.h:104-110` and the resource ids the cheer path pulls.
 * Cheering costs one point, plays a gendered motion + SFX pair on both parties,
 * turns the cheerer to face the target, and applies the `II_CHEERUP` buff.
 *
 * @module entities/constants/cheer
 */

/** `MAX_CHEERPOINT` (`Mover.h:110`) -- point stock ceiling. */
export const MAX_CHEERPOINT = 3;

/**
 * `TICK_CHEERPOINT` (`Mover.h:107`) -- 60 minutes between point regens.
 * (`Mover.h:105` uses `MIN(1)` under `__INTERNALSERVER`; the live build is 60.)
 */
export const TICK_CHEERPOINT_MS = 60 * 60 * 1_000;

/** `MTI_CHEERSAME` (`resource/defineNeuz.h:620`) -- same-sex cheer motion. */
export const MTI_CHEERSAME = 145;
/** `MTI_CHEEROTHER` (`resource/defineNeuz.h:621`) -- opposite-sex cheer motion. */
export const MTI_CHEEROTHER = 146;

/** `XI_CHEERSENDEFFECT` (`resource/defineObj.h:853`) -- SFX on the cheerer. */
export const XI_CHEERSENDEFFECT = 1717;
/** `XI_CHEERRECEIVEEFFECT` (`resource/defineObj.h:854`) -- SFX on the target. */
export const XI_CHEERRECEIVEEFFECT = 1718;

/**
 * `II_CHEERUP` (`resource/defineItem.h:2587`) -- the buff is a virtual item
 * (`IK1_SYSTEM/IK2_SYSTEM/IK3_VIRTUAL`, `propItem.txt:1742`) applied via
 * `DoApplySkill`, duration 600000 ms. Not persisted: `DPDatabaseClient.cpp:744`
 * strips it on load.
 */
export const II_CHEERUP = 10445;
/** `II_CHEERUP` duration in ms (`propItem.txt:1742` column). */
export const CHEERUP_DURATION_MS = 600_000;

/** `TID_CHEER_MESSAGE3` (`defineText.h:1727`) -- same-sex cheer received. */
export const TID_CHEER_MESSAGE3 = 2645;
/** `TID_CHEER_MESSAGE4` (`defineText.h:1728`) -- opposite-sex cheer received. */
export const TID_CHEER_MESSAGE4 = 2646;
/** `TID_CHEER_NO1` (`defineText.h:1729`) -- out of points; arg = minutes left. */
export const TID_CHEER_NO1 = 2647;
/** `TID_CHEER_NO2` (`defineText.h:1730`) -- target is not a player. */
export const TID_CHEER_NO2 = 2648;

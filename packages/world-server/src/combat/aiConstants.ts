/**
 * Shared C++ AI/combat constants — the leash, speed, range, and cadence values
 * from `_AIInterface/AIMonster.cpp` + `_Common/MoverMsg.cpp`. Imported by
 * `CombatService` (rage trigger) and `AISystem` (pursue/leash/swing) so both
 * sides agree on the same numbers.
 *
 * @module combat/aiConstants
 */

/** `RANGE_MOVE` (`AIMonster.cpp:19`) — idle-wander + return leash from spawn. */
export const RANGE_MOVE = 30.0;
/** `RANGE_RETURN_TO_BEGIN` (`AIMonster.cpp:21`) — damage-pos pursuit leash. */
export const RANGE_RETURN_TO_BEGIN = 120.0;
/** RAGE leash from spawn anchor = `RANGE_RETURN_TO_BEGIN + RANGE_MOVE` (150 m). */
export const RAGE_LEASH = RANGE_RETURN_TO_BEGIN + RANGE_MOVE;
/** Ground-plane distance (m) counted as "arrived home" (`MoveProcessIdle:334`). */
export const HOME_ARRIVAL = 7.0;
/** Sight-detection radius (`m_nAttackFirstRange`, `AIMonster.cpp:417`; default 10). */
export const SIGHT_RANGE = 10.0;

/** Melee contact distance (AR_LONG, `MoverMsg.cpp:145` + model radii). */
export const MELEE_ATTACK_RANGE = 3.0;
/**
 * Default ranged-attack distance when a monster has no explicit `attack_range`
 * (`AR_RANGE` = 10 m, `MoverMsg.cpp:140-166`). Ranged monsters (`BELLI_RANGE_*`,
 * weapon `dwAttackRange ∈ {AR_RANGE, AR_WAND}` per `AIMonster.cpp:1273`) shoot
 * from here instead of closing to contact.
 */
export const RANGE_ATTACK_RANGE = 10.0;
/** Pursue speed factor (`SetSpeedFactor(2.0F)`, `AIMonster.cpp:163`). */
export const PURSUE_SPEED_FACTOR = 2.0;
/** Return-home speed factor (`SetSpeedFactor(2.66F)`, `AIMonster.cpp:295`). */
export const RETURN_SPEED_FACTOR = 2.66;
/** Chase-window + anti-stuck gate (`s_tmAttack = SEC(15)`, `AIMonster.cpp:78`). */
export const CHASE_WINDOW_MS = 15_000;
/** Return-home stuck-teleport cap (`MoveProcessIdle:367-376` — 20 s). */
export const RETURN_STUCK_MS = 20_000;

/**
 * Default NPC re-attack delay (`dwReAttackDelay − 1000 + rand(0..2000)`,
 * `AIMonster.cpp:1381`). ponytail: per-mover `dwReAttackDelay` once the resource
 * converter exports col 35; Aibatt=6 s, typical low mob 1.3–2 s. 2000 ms base.
 */
export const REATTACK_DELAY_MS = 2000;
export const REATTACK_JITTER_MS = 2000;
/**
 * Fixed ranged-attack cadence (`SEC(3)`, `AIMonster.cpp:1370`) — C++ ignores
 * `dwReAttackDelay` for the ranged `SubAttackChance` branch.
 */
export const RANGE_REATTACK_DELAY_MS = 3000;

/**
 * v15 movement scale. C++ steps `vPos.xz += 4·dir·fSpeed` per 67 ms tick
 * (`ActionMoverState.cpp:229` + `MoverMove.cpp:3813`) → units/sec ≈
 * `fSpeed · speedFactor · (4·1000/67)` ≈ fSpeed · speedFactor · 59.7.
 * An Aibatt (fSpeed 0.075) walks ≈ 4.5 u/s, matching the client.
 */
export const SPEED_SCALE = (4 * 1000) / 67;

/**
 * `OBJMSG_*` attack-animation ids (`_Common/MoverMsg.h:107-142`, enum counted
 * from `OBJMSG_NONE=0`). AI-driven monster swings send these as `dwAtkMsg`:
 * melee → `OBJMSG_ATK1` (29), ranged → `OBJMSG_ATK_RANGE1` (35). The player
 * C→S path reads `dwAtkMsg` off the wire instead.
 */
export const OBJMSG_ATK1 = 29;
export const OBJMSG_ATK_RANGE1 = 35;
/**
 * `OBJMSG_STOP` (`_Common/MoverMsg.h:113`, enum index 6 from `OBJMSG_NONE=0`).
 * `DoDie` sends `SendActMsg(OBJMSG_STOP)` (`Mover.cpp:5204`) to halt the dying
 * mover before the death motion.
 */
export const OBJMSG_STOP = 6;
/**
 * `OBJMSG_DIE` (`_Common/MoverMsg.h:147`, enum index 40). `DoDie` sends
 * `SendActMsg(OBJMSG_DIE, dwMsg, attacker)` (`Mover.cpp:5205`) to the dying
 * client — Neuz opens `CWndRevival` (the revive dialog) on this
 * (`_Interface/WndField.cpp:12109`).
 */
export const OBJMSG_DIE = 40;

/**
 * `II_SYS_SYS_SCR_RESURRECTION` (10431, `resource/defineItem.h:2477`) — the
 * resurrection scroll `OnRevival` looks up + consumes 1 of for in-place revive.
 * `m_Inventory.GetAtItemId(...)` (`DPSrvr.cpp:976`) → `RemoveItem(objId, 1)`
 * (`DPSrvr.cpp:1039`). Town revive (lodestar) does NOT require a scroll.
 */
export const II_SYS_SYS_SCR_RESURRECTION = 10431;

/** BELLI values with `m_bActiveAttack == TRUE` (sight-aggro, `defineAttribute.h:203`). */
export const ACTIVE_BELLI: ReadonlySet<number> = new Set([3, 5, 6, 7, 11, 12, 13]);

/**
 * Sight-aggro level band — a red-name mob auto-acquires only players within
 * this many levels ABOVE it (`player.level <= mob.level + AGGRO_LEVEL_BAND`).
 * ponytail: CUSTOM deviation — v15 `ScanTarget` (`AIInterface.cpp:166`) has NO
 * level filter; a level-1 active mob aggros a level-120 player in vanilla. Set
 * to the standard red/orange name window so trash mobs stop harassing
 * out-leveled players. Remove to restore strict C++ fidelity.
 */
export const AGGRO_LEVEL_BAND = 9;

/**
 * BELLI values that select the ranged attack branch (`*_RANGE` variants,
 * `defineAttribute.h:203-215`: ACTIVEATTACK_RANGE=7, CAUTIOUSATTACK_RANGE=10,
 * RANGE=13). These monsters shoot from `attack_range` distance instead of
 * closing to melee (`AIMonster.cpp:1273` weapon `dwAttackRange ∈ {AR_RANGE,
 * AR_WAND}`); we don't load propMover weapons so the belli flag is the proxy.
 */
export const BELLI_RANGE_KEYS: ReadonlySet<number> = new Set([7, 10, 13]);

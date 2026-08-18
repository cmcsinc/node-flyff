/**
 * `CActionMover::m_dwStateFlag` bit flags -- mirrors `_Common/MoverMsg.h:95-102`.
 *
 * Distinct from {@link MODE} (`m_dwMode`, GM toggles): the state flag is the
 * *action* state of the mover and rides on the wire in two places -- the
 * `GetStateFlag()` DWORD of `CMover::Serialize` (ADD_OBJ,
 * `ObjSerializeOpt.cpp:100-135`) and every `MOVERMOVED*`/`MOVERBEHAVIOR*`
 * frame. There is no dedicated flight opcode in v19; `FLY` in this DWORD is the
 * entire wire signal that a mover is airborne.
 *
 * Only `FLY` is enforced today. `ACC`/`TURBO` are listed because the turbo-fuel
 * drain (`ActionMoverState2.cpp:360`) reads them, and `dismount` must clear them
 * alongside `FLY` (`ActionMoverMsg2.cpp:271-307`); the turbo subsystem itself is
 * unported (ponytail).
 *
 * @module constants/stateFlag
 */

export const OBJSTAF = Object.freeze({
  /** Combat stance. MoverMsg.h:96 -- `OBJSTAF_COMBAT`. */
  COMBAT: 0x00000001,
  /** Walking (vs running). MoverMsg.h:97 -- `OBJSTAF_WALK`. */
  WALK: 0x00000002,
  /** Sitting. MoverMsg.h:98 -- `OBJSTAF_SIT`. */
  SIT: 0x00000004,
  /**
   * Airborne on a `PARTS_RIDE` item (board/broom). MoverMsg.h:99 --
   * `OBJSTAF_FLY`. Set by the equip tail's `OBJMSG_MODE_FLY`
   * (`MoverEquip.cpp:1836`), cleared by `OBJMSG_MODE_GROUND`.
   */
  FLY: 0x00000008,
  /** Accelerating. MoverMsg.h:100 -- `OBJSTAF_ACC`. */
  ACC: 0x00000010,
  /** Custom/etc. MoverMsg.h:101 -- `OBJSTAF_ETC`. */
  ETC: 0x00000020,
  /** Turning under acceleration. MoverMsg.h:102 -- `OBJSTAF_ACCTURN`. */
  ACCTURN: 0x00000040,
  /** Turbo boost (burns `m_tmAccFuel`). MoverMsg.h:103 -- `OBJSTAF_TURBO`. */
  TURBO: 0x00000080,
} as const);

/**
 * Equip slot for a ride item (board/broom/wing). `resource/defineNeuz.h:44` --
 * `PARTS_RIDE`. Within `MAX_HUMAN_PARTS` (31), so it occupies a normal equip
 * slot; what makes it special is only the flight-state side effect.
 */
export const PARTS_RIDE = 13;

/** Right-hand weapon slot. `resource/defineNeuz.h:41` -- `PARTS_RWEAPON`. */
export const PARTS_RWEAPON = 10;

/**
 * Equipped-ammo slot (arrows / crossbow bolts). `resource/defineNeuz.h:61` --
 * `PARTS_BULLET`. A bow's ranged attack requires an `IK3_ARROW` stack here and
 * burns one per swing (`CMover::ArrowDown`, `_Common/Mover.cpp:8720`).
 */
export const PARTS_BULLET = 25;

/**
 * Minimum character level for `dwFlightLimit == 1` ride items -- i.e. every ride
 * item in `Spec_Item.txt`.
 *
 * v19 does not store a flight level: `CMover::GetFlightLv()` is *derived* as
 * `GetLevel() >= 20 ? 1 : 0` and `SetFlightLv()` is an empty body
 * (`_Common/Mover.h:549`, under the `__VER >= 12` / `__MOD_TUTORIAL` branch that
 * this build compiles). The legacy `m_nFlightLv` member and the `SETFXP` /
 * `SETFLIGHTLEVEL` exp track are dead code here, so there is nothing to persist
 * and no progression to grant.
 */
export const FLIGHT_LV_MIN_LEVEL = 20;

/**
 * `CMover::m_dwFlag` bits (`_Common/MoverMsg.h:186`) -- a **separate** DWORD from
 * {@link OBJSTAF}. Only the one-shot critical bonus is ported: `CParty::
 * DoUsePartySkill` arms it under `case ST_SPHERECIRCLE:` (`party.cpp:462`/`:469`)
 * and `GetCriticalProb` consumes + clears it on the very next crit roll
 * (`MoverAttack.cpp:697-707`) -- whether or not that attack could even crit.
 */
export const MVRF = Object.freeze({
  /** `MVRF_CRITICAL` -- next crit roll gains `partySize/2`. One-shot. */
  CRITICAL: 0x00000002,
} as const);

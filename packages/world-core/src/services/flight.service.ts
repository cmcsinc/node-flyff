/**
 * FlightService -- mount / dismount a `PARTS_RIDE` item (board, broom, wing).
 *
 * v19 has **no mount or pet-riding system**: there is no `m_pVehicle`, no
 * ride-mover id, and no boarding packet. All flight is one mechanic -- equipping
 * an item whose `dwParts == PARTS_RIDE` (13). Board (`IK3_BOARD`) and broom
 * (`IK3_STICK`) differ only cosmetically and in which fuel item refills them;
 * animal-looking rides (Piyoko) are ordinary ride items with animal models.
 *
 * There is likewise no flight opcode. Mounting sets `OBJSTAF_FLY` in the
 * action-state-flag DWORD, which already rides on the wire in `CMover::Serialize`
 * (ADD_OBJ) and every `MOVERMOVED*`/`MOVERBEHAVIOR*` frame. The DOEQUIP snapshot
 * the equip handler already sends is the complete client signal; this service
 * emits nothing.
 *
 * Ports the `PARTS_RIDE` block of `CMover::IsEquipAble`
 * (`_Common/MoverEquip.cpp:1498-1570`) for the gate, and the
 * `OBJMSG_MODE_FLY` / `OBJMSG_MODE_GROUND` action handlers
 * (`_AIInterface/ActionMoverMsg.cpp:1053-1111`,
 * `ActionMoverMsg2.cpp:271-307`) for the state transition.
 *
 * ponytail: three of C++'s eight mount gates cannot be checked yet, each for
 * want of an unported subsystem --
 *   - `HATTR_NOFLY` per-tile terrain (`landscape.h:36`): no heightmap/`.lnd`
 *     parsing exists, so no height attribute is available anywhere in the server.
 *   - `IK3_TEXT_DISGUISE` buff (`TID_QUEST_DISQUISE_NOTFLY` 2545): buffs are not
 *     indexed by the source item's IK3.
 *   - summoned pet (`TID_GAME_CANNOT_FLY_WITH_PET` 3209): no pet system.
 * ponytail: fuel. Flight fuel (`m_nFuel`) is seeded on mount but v19 never
 * decrements it -- the sole decrement site is commented out
 * (`ActionMoverMsg2.cpp:262`). Turbo fuel (`m_tmAccFuel`) does drain, 1/60 s per
 * frame under `TURBO|ACC` (`ActionMoverState2.cpp:360-374`); neither the turbo
 * state nor `SETFUEL`/`IK2_AIRFUEL` refuelling is ported.
 *
 * @module services/flight.service
 */

import type { ItemDefinition, ZoneDefinition } from '@flyff/resources';
import type { CPlayer } from '@flyff/entities';
import { OBJSTAF } from '@flyff/entities';
import { NULL_ID } from '../snapshot-constants';

/**
 * `defineText.h` ids for the mount refusals we can actually evaluate. The client
 * renders these through `SNAPSHOTTYPE_DEFINEDTEXT`.
 */
export const FLIGHT_TID = Object.freeze({
  /** 612 -- flight level too low ("please wait a moment"). defineText.h:230. */
  USEAIRCRAFT: 612,
  /** 2405 -- this world forbids flight. defineText.h:1516. */
  NOFLY: 2405,
  /** 3135 -- chaotic (PK) players may not fly. defineText.h:2165. */
  CHAOTIC_NOT_FLY: 3135,
  /** 3457 -- client-reported `fFlightSpeed` disagreed with the item. defineText.h:2535. */
  MODIFY_FLIGHT_SPEED: 3457,
} as const);

/**
 * Refusal reason. `tid` is present when C++ shows the player a defined-text
 * notice; a bare `silent` refusal mirrors C++'s plain `return FALSE`.
 */
export type MountRefusal =
  | { ok: false; tid: number }
  | { ok: false; silent: true };

export type MountCheck = { ok: true } | MountRefusal;

export interface FlightServiceDeps {
  /** Zone index -- read for the per-world `fly` permission (`CWorld::m_bFly`). */
  zones: { byNumericId: Map<number, ZoneDefinition> };
}

export class FlightService {
  constructor(private readonly deps: FlightServiceDeps) {}

  /**
   * May `player` mount the ride item described by `prop`? Gate order follows
   * `CMover::IsEquipAble` (`MoverEquip.cpp:1498-1570`) so the notice a player
   * sees matches the original server when several gates would fail at once.
   */
  canMount(player: CPlayer, prop: ItemDefinition): MountCheck {
    // 1. Flight level. `dwFlightLimit` normalizes NULL_ID -> 1 in the converter;
    //    `getFlightLv()` is derived (level >= 20 ? 1 : 0), so this is the level gate.
    if (player.getFlightLv() < (prop.flight_limit ?? 1)) {
      return { ok: false, tid: FLIGHT_TID.USEAIRCRAFT };
    }
    // 2. Per-world permission (`CWorld::m_bFly`). An unknown zone id is treated
    //    as flyable, matching the C++ default (`World.cpp:92` inits TRUE) rather
    //    than locking a player out of a zone we simply failed to index.
    const zone = this.deps.zones.byNumericId.get(player.m_nZoneId);
    if (zone && !zone.fly) {
      return { ok: false, tid: FLIGHT_TID.NOFLY };
    }
    // 3./4. disguise buff + HATTR_NOFLY terrain -- ponytail, see module doc.
    // 5. Must be idle and able to act. C++ requires `OBJSTA_STAND`
    //    (`MoverEquip.cpp:1554`, world-server only); we have no action-state
    //    machine, so dead/stunned is the closest faithful subset.
    if (player.m_bDead || player.isStunned()) {
      return { ok: false, silent: true };
    }
    // 6. Chaotic PK players are grounded (`GetPropensityPenalty(...).nFly == 0`,
    //    MoverEquip.cpp:1565). We have no propensity-penalty table, so every
    //    chaotic player is refused -- the C++ table's `nFly` is 0 for all
    //    chaotic tiers.
    if (player.isChaotic()) {
      return { ok: false, tid: FLIGHT_TID.CHAOTIC_NOT_FLY };
    }
    // 7. pet conflict -- ponytail, see module doc.
    return { ok: true };
  }

  /**
   * `__HACK_1023` speed-hack check (`DPSrvr.cpp:793-807`). The client echoes the
   * item's own `fFlightSpeed` on the DOEQUIP that mounts it; a mismatch means a
   * patched client trying to fly faster than the item allows.
   *
   * Compared with a tolerance because the value crosses the wire as a 32-bit
   * float and our YAML holds the decimal the source table printed -- an exact
   * `===` would reject every legitimate mount. The tolerance is far tighter than
   * the smallest gap between real ride speeds (0.0023 vs 0.0026).
   */
  isFlightSpeedValid(prop: ItemDefinition, claimed: number): boolean {
    const expected = prop.flight_speed;
    // No flight_speed in data => nothing to verify against; accept (the item is
    // still gated by every check in `canMount`).
    if (expected === undefined) return true;
    return Math.abs(expected - claimed) < 1e-6;
  }

  /**
   * Enter flight. Ports `OBJMSG_MODE_FLY` (`ActionMoverMsg.cpp:1076-1111`) plus
   * the equip tail's `ClearDest()` / `ClearDestAngle()`
   * (`MoverEquip.cpp:1843-1845`) -- a walk-to destination cannot survive the
   * transition or the player would keep pathing on the ground while airborne.
   */
  mount(player: CPlayer): void {
    player.m_dwStateFlag |= OBJSTAF.FLY;
    this.clearDest(player);
  }

  /**
   * Leave flight. Ports `OBJMSG_MODE_GROUND` (`ActionMoverMsg2.cpp:271-307`):
   * clears `FLY` **and** `ACC`, resets pitch, clears the destination. `TURBO` is
   * cleared too -- C++ only removes `FLY|ACC` there because turbo is already
   * impossible without them, but leaving a stale bit set would leak into the
   * next mount's serialized state flag.
   */
  dismount(player: CPlayer): void {
    player.m_dwStateFlag &= ~(OBJSTAF.FLY | OBJSTAF.ACC | OBJSTAF.TURBO);
    player.m_fAngleX = 0;
    this.clearDest(player);
  }

  private clearDest(player: CPlayer): void {
    player.m_idDestObj = NULL_ID;
    player.m_fArrivalRange = 0;
  }
}

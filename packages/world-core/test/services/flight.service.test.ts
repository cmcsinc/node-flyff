/**
 * FlightService test -- mount gate + state transitions.
 *
 * Each gate of `CMover::IsEquipAble` PARTS_RIDE block (MoverEquip.cpp:1498-1570)
 * is exercised independently. State transitions (mount/dismount) assert the
 * OBJSTAF bits + destination clear.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { FlightService, FLIGHT_TID } from '../../src/services/flight.service';
import { OBJSTAF, NULL_ID } from '@flyff/entities';
import type { CPlayer } from '@flyff/entities';
import type { ItemDefinition, ZoneIndex } from '@flyff/resources';

function makePlayer(over: Partial<CPlayer> = {}): CPlayer {
  const base = {
    m_nLevel: 20,
    m_nZoneId: 1,
    m_bDead: false,
    m_dwPKPropensity: 0,
    m_dwStateFlag: 0,
    m_idDestObj: NULL_ID,
    m_fArrivalRange: 5,
    m_fAngleX: 0.3,
    isStunned(): boolean { return false; },
    isChaotic(): boolean { return this.m_dwPKPropensity > 0; },
    getFlightLv(): number { return this.m_nLevel >= 20 ? 1 : 0; },
    isFly(): boolean { return (this.m_dwStateFlag & OBJSTAF.FLY) !== 0; },
  };
  return Object.assign(base, over) as unknown as CPlayer;
}

function rideProp(over: Partial<ItemDefinition> = {}): ItemDefinition {
  return {
    id: 9000, name: 'Board', name_id: 'B', stack_size: 1, weight: 1,
    level_req: 1, price: 0, sell_price: 0,
    equip_slot: 13, flight_limit: 1, flight_speed: 0.0023,
    ...over,
  } as ItemDefinition;
}

function makeZones(fly: boolean): Pick<ZoneIndex, 'byNumericId'> {
  return { byNumericId: new Map([[1, { fly } as never]]) };
}

describe('FlightService.canMount', () => {
  it('level 20, flyable zone -> ok', () => {
    const svc = new FlightService({ zones: makeZones(true) });
    assert.equal(svc.canMount(makePlayer(), rideProp()).ok, true);
  });

  it('level 19 -> USEAIRCRAFT(612)', () => {
    const svc = new FlightService({ zones: makeZones(true) });
    const r = svc.canMount(makePlayer({ m_nLevel: 19 }), rideProp());
    assert.equal(r.ok, false);
    if (!r.ok && 'tid' in r) assert.equal(r.tid, FLIGHT_TID.USEAIRCRAFT);
  });

  it('no-fly zone -> NOFLY(2405)', () => {
    const svc = new FlightService({ zones: makeZones(false) });
    const r = svc.canMount(makePlayer(), rideProp());
    assert.equal(r.ok, false);
    if (!r.ok && 'tid' in r) assert.equal(r.tid, FLIGHT_TID.NOFLY);
  });

  it('chaotic player -> CHAOTIC_NOT_FLY(3135)', () => {
    const svc = new FlightService({ zones: makeZones(true) });
    const r = svc.canMount(makePlayer({ m_dwPKPropensity: 5 }), rideProp());
    assert.equal(r.ok, false);
    if (!r.ok && 'tid' in r) assert.equal(r.tid, FLIGHT_TID.CHAOTIC_NOT_FLY);
  });

  it('dead -> silent refusal', () => {
    const svc = new FlightService({ zones: makeZones(true) });
    const r = svc.canMount(makePlayer({ m_bDead: true }), rideProp());
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal('silent' in r, true);
  });

  it('level gate beats world gate (C++ order)', () => {
    // C++ checks flight level before world permission; a low-level player in a
    // no-fly zone sees USEAIRCRAFT, not NOFLY.
    const svc = new FlightService({ zones: makeZones(false) });
    const r = svc.canMount(makePlayer({ m_nLevel: 19 }), rideProp());
    if (!r.ok && 'tid' in r) assert.equal(r.tid, FLIGHT_TID.USEAIRCRAFT);
  });
});

describe('FlightService.isFlightSpeedValid', () => {
  it('exact match -> valid', () => {
    const svc = new FlightService({ zones: makeZones(true) });
    assert.equal(svc.isFlightSpeedValid(rideProp(), 0.0023), true);
  });
  it('tampered -> invalid', () => {
    const svc = new FlightService({ zones: makeZones(true) });
    assert.equal(svc.isFlightSpeedValid(rideProp(), 0.099), false);
  });
  it('prop without flight_speed -> valid (nothing to check)', () => {
    const svc = new FlightService({ zones: makeZones(true) });
    assert.equal(svc.isFlightSpeedValid(rideProp({ flight_speed: undefined }), 0), true);
  });
});

describe('FlightService.mount / dismount', () => {
  it('mount sets FLY and clears the walk-to destination', () => {
    const svc = new FlightService({ zones: makeZones(true) });
    const p = makePlayer();
    svc.mount(p);
    assert.equal((p.m_dwStateFlag & OBJSTAF.FLY) !== 0, true, 'FLY set');
    assert.equal(p.m_idDestObj, NULL_ID, 'dest obj cleared');
    assert.equal(p.m_fArrivalRange, 0, 'arrival range cleared');
  });

  it('dismount clears FLY|ACC|TURBO and resets pitch', () => {
    const svc = new FlightService({ zones: makeZones(true) });
    const p = makePlayer({ m_dwStateFlag: OBJSTAF.FLY | OBJSTAF.ACC | OBJSTAF.TURBO, m_fAngleX: 0.4 });
    svc.dismount(p);
    assert.equal(p.m_dwStateFlag & (OBJSTAF.FLY | OBJSTAF.ACC | OBJSTAF.TURBO), 0, 'all flight bits cleared');
    assert.equal(p.m_fAngleX, 0, 'pitch reset');
  });
});

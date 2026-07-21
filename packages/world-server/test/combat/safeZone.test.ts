/**
 * safeZone predicate unit tests.
 */
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { isInSafeZone, TOWN_EXCLUSION_RADIUS } from '../../src/combat/safeZone.js';
import type { Vec3 } from '../../src/entities/player.js';

const TOWN: Vec3 = { x: 6978, y: 100, z: 3329 };

describe('safeZone', () => {
  it('TOWN_EXCLUSION_RADIUS is 1000 (matches spawn exclusion)', () => {
    assert.equal(TOWN_EXCLUSION_RADIUS, 1000);
  });

  it('position at the revival point is in the safe zone', () => {
    assert.equal(isInSafeZone(TOWN, TOWN), true);
  });

  it('position just inside the radius is safe', () => {
    const inside: Vec3 = { x: TOWN.x + 999, y: 0, z: TOWN.z };
    assert.equal(isInSafeZone(inside, TOWN), true);
  });

  it('position just outside the radius is NOT safe', () => {
    const outside: Vec3 = { x: TOWN.x + 1000, y: 0, z: TOWN.z };
    assert.equal(isInSafeZone(outside, TOWN), false);
  });

  it('distance is measured on the x/z plane (y ignored)', () => {
    const high: Vec3 = { x: TOWN.x, y: 99999, z: TOWN.z };
    assert.equal(isInSafeZone(high, TOWN), true);
  });

  it('undefined revival position ⇒ not safe (no revival data for zone)', () => {
    assert.equal(isInSafeZone(TOWN, undefined), false);
  });
});

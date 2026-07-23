import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PlayerManager } from '@flyff/world-core';
import { CPlayer } from '@flyff/entities';
import type { CharacterRow } from '@flyff/database';

function makeRow(id: number): CharacterRow {
  return {
    id, account_id: 1, name: `P${id}`, slot: 0, class: 1, gender: 0,
    hair_style: 0, hair_color: 0, face_style: 0, skin_color: 0, level: 1,
    exp: 0n, hp: 1, mp: 1, max_hp: 1, max_mp: 1, strength: 1, stamina: 1,
    dexterity: 1, intelligence: 1, x: 0, y: 0, z: 0, world_id: 'W', zone_id: 1,
    created_at: new Date(), updated_at: new Date(),
  };
}

function sock() {
  return { write: () => true };
}

describe('PlayerManager', () => {
  it('add -> get returns the same player (O(1) Map lookup)', () => {
    const mgr = new PlayerManager();
    const p = CPlayer.fromRow(makeRow(5), sock());
    mgr.add(p);
    assert.equal(mgr.get(5), p);
  });

  it('get unknown charId returns undefined', () => {
    const mgr = new PlayerManager();
    assert.equal(mgr.get(999), undefined);
  });

  it('remove returns true and clears the entry', () => {
    const mgr = new PlayerManager();
    mgr.add(CPlayer.fromRow(makeRow(7), sock()));
    assert.equal(mgr.remove(7), true);
    assert.equal(mgr.get(7), undefined);
    assert.equal(mgr.size, 0);
  });

  it('remove unknown charId returns false', () => {
    const mgr = new PlayerManager();
    assert.equal(mgr.remove(123), false);
  });

  it('size tracks add/remove', () => {
    const mgr = new PlayerManager();
    assert.equal(mgr.size, 0);
    mgr.add(CPlayer.fromRow(makeRow(1), sock()));
    mgr.add(CPlayer.fromRow(makeRow(2), sock()));
    assert.equal(mgr.size, 2);
    mgr.remove(1);
    assert.equal(mgr.size, 1);
  });

  it('all() returns the live player set', () => {
    const mgr = new PlayerManager();
    const a = CPlayer.fromRow(makeRow(1), sock());
    const b = CPlayer.fromRow(makeRow(2), sock());
    mgr.add(a); mgr.add(b);
    assert.deepEqual(new Set(mgr.all()), new Set([a, b]));
  });
});

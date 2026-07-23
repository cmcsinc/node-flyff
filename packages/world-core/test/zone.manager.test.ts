import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { ZoneManager } from '@flyff/world-core';
import { CPlayer } from '@flyff/entities';
import type { CharacterRow } from '@flyff/database';

interface SpySocket {
  write: (b: Buffer) => boolean;
  _sent: Buffer[];
}

function makeRow(id: number, zoneId: number, x: number): CharacterRow {
  return {
    id, account_id: 1, name: `P${id}`, slot: 0, class: 1, gender: 0,
    hair_style: 0, hair_color: 0, face_style: 0, skin_color: 0, level: 1,
    exp: 0n, hp: 1, mp: 1, max_hp: 1, max_mp: 1, strength: 1, stamina: 1,
    dexterity: 1, intelligence: 1, x, y: 0, z: 0, world_id: 'W', zone_id: zoneId,
    created_at: new Date(), updated_at: new Date(),
  };
}
function spySock(): SpySocket {
  const sent: Buffer[] = [];
  return { write: (b) => { sent.push(b); return true; }, _sent: sent };
}

describe('ZoneManager', () => {
  it('broadcasts only to players in the same zone within radius', () => {
    const z = new ZoneManager();
    const near = CPlayer.fromRow(makeRow(1, 1, 10), spySock());
    const far = CPlayer.fromRow(makeRow(2, 1, 500), spySock());
    const otherZone = CPlayer.fromRow(makeRow(3, 2, 10), spySock());
    z.place(near); z.place(far); z.place(otherZone);

    const pkt = Buffer.from([0xff]);
    const reached = z.broadcastAround({ x: 0, y: 0, z: 0 }, 1, 100, pkt);

    assert.equal(reached, 1);
    assert.equal((near.socket as unknown as SpySocket)._sent.length, 1);
    assert.equal((far.socket as unknown as SpySocket)._sent.length, 0);
    assert.equal((otherZone.socket as unknown as SpySocket)._sent.length, 0);
  });

  it('skips the except player', () => {
    const z = new ZoneManager();
    const a = CPlayer.fromRow(makeRow(1, 1, 0), spySock());
    const b = CPlayer.fromRow(makeRow(2, 1, 0), spySock());
    z.place(a); z.place(b);

    const reached = z.broadcastAround({ x: 0, y: 0, z: 0 }, 1, 100, Buffer.alloc(1), a);
    assert.equal(reached, 1);
    assert.equal((a.socket as unknown as SpySocket)._sent.length, 0);
    assert.equal((b.socket as unknown as SpySocket)._sent.length, 1);
  });

  it('remove drops the player from broadcast reach', () => {
    const z = new ZoneManager();
    const a = CPlayer.fromRow(makeRow(1, 1, 0), spySock());
    z.place(a);
    z.remove(a);
    const reached = z.broadcastAround({ x: 0, y: 0, z: 0 }, 1, 100, Buffer.alloc(1));
    assert.equal(reached, 0);
  });

  it('broadcastZone reaches every player in that zone regardless of radius', () => {
    const z = new ZoneManager();
    const a = CPlayer.fromRow(makeRow(1, 1, 0), spySock());
    const b = CPlayer.fromRow(makeRow(2, 1, 9999), spySock());
    const c = CPlayer.fromRow(makeRow(3, 2, 0), spySock());
    z.place(a); z.place(b); z.place(c);
    const reached = z.broadcastZone(1, Buffer.alloc(1));
    assert.equal(reached, 2);
  });
});

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CPlayer } from '../../src/entities/player.js';
import type { CharacterRow } from '@flyff/database';

function makeRow(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 42,
    account_id: 7,
    name: 'TestHero',
    slot: 0,
    class: 1,
    gender: 0,
    hair_style: 2,
    hair_color: 0x112233,
    face_style: 3,
    skin_color: 1,
    level: 15,
    exp: 0n,
    gold: 0,
    hp: 100,
    mp: 50,
    max_hp: 100,
    max_mp: 50,
    strength: 15,
    stamina: 15,
    dexterity: 15,
    intelligence: 15,
    x: 1.5,
    y: 2.5,
    z: 3.5,
    world_id: 'MADRIGAL',
    zone_id: 1,
    created_at: new Date(),
    updated_at: new Date(),
    ...over,
  };
}

function makeSocket() {
  const written: Buffer[] = [];
  return { write: (b: Buffer) => { written.push(b); return true; }, _written: written };
}

describe('CPlayer entity', () => {
  it('maps a CharacterRow into C++-style fields', () => {
    const sock = makeSocket();
    const p = CPlayer.fromRow(makeRow(), sock);

    assert.equal(p.m_idPlayer, 42);
    assert.equal(p.m_szName, 'TestHero');
    assert.equal(p.m_nLevel, 15);
    assert.equal(p.m_nJob, 1);
    assert.equal(p.m_nSex, 0);
    assert.equal(p.m_nGold, 0);
    assert.deepEqual(p.m_vPos, { x: 1.5, y: 2.5, z: 3.5 });
    assert.equal(p.m_nHp, 100);
    assert.equal(p.m_nMp, 50);
    assert.equal(p.m_nStr, 15);
    assert.equal(p.m_dwSkin, 1);
    assert.equal(p.m_nHairMesh, 2);
    assert.equal(p.m_dwHairColor, 0x112233);
    assert.equal(p.m_nHeadMesh, 3);
    assert.equal(p.m_worldId, 'MADRIGAL');
    assert.equal(p.m_nZoneId, 1);
    assert.equal(p.socket, sock);
  });

  it('starts with an empty _dirty set', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    assert.equal(p._dirty.size, 0);
  });

  it('hydrates m_nGold from the row (migration 003)', () => {
    const p = CPlayer.fromRow(makeRow({ gold: 4500 }), makeSocket());
    assert.equal(p.m_nGold, 4500);
  });

  it('marks dirty fields for partial flush', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    p.m_nHp = 80;
    p._dirty.add('m_nHp');
    assert.ok(p._dirty.has('m_nHp'));
  });

  it('writes through the held socket reference', () => {
    const sock = makeSocket();
    const p = CPlayer.fromRow(makeRow(), sock);
    const buf = Buffer.from([1, 2, 3]);
    p.socket.write(buf);
    assert.equal(sock._written[0], buf);
  });
});

/**
 * MovementService unit tests -- dead-gate + anti-teleport echo paths.
 *
 * The death lockout (`m_bDead`) drops all movement frames so a corpse cannot
 * walk around. Covers applyMovement/applyBehavior/applyCorr/applyMoved2.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { MovementService } from '../../src/services/movement.service';
import type { MovementFrame, Movement2Frame } from '../../src/net/snapshot/moverBroadcast.serializer';
import { CPlayer } from '@flyff/entities';
import type { CharacterRow } from '@flyff/database';

function makeRow(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 1, account_id: 1, name: 'Tester', slot: 0, class: 0, gender: 0,
    hair_style: 0, hair_color: 0, face_style: 0, skin_color: 0,
    level: 1, exp: 0n, hp: 200, mp: 100, max_hp: 200, max_mp: 100,
    strength: 15, stamina: 15, dexterity: 15, intelligence: 15,
    x: 0, y: 0, z: 0, world_id: 'flaris', zone_id: 1,
    created_at: new Date(), updated_at: new Date(),
    ...over,
  };
}

function makePlayer(): CPlayer {
  return CPlayer.fromRow(makeRow(), { write: () => true });
}

const nearFrame = (x = 5): MovementFrame => ({
  v: { x, y: 0, z: 0 },
  vd: { x: 0, y: 0, z: 0 },
  f: 0, dwState: 0, dwStateFlag: 0, dwMotion: 0,
  nMotionEx: 0, nLoop: 0, dwMotionOption: 0, nTickCount: 0n,
});

const near2Frame = (x = 5): Movement2Frame => ({ ...nearFrame(x), nFrame: 0 });

function makeService() {
  const broadcasts: Buffer[] = [];
  const svc = new MovementService({
    zoneManager: {
      broadcastAround: () => { broadcasts.push(Buffer.alloc(0)); return 1; },
    } as never,
  });
  return { svc, broadcasts };
}

describe('MovementService death lockout', () => {
  it('applyMovement drops a dead player (reason dead) without moving or broadcasting', () => {
    const { svc, broadcasts } = makeService();
    const p = makePlayer();
    p.m_bDead = true;
    const before = { ...p.m_vPos };

    const out = svc.applyMovement(p, nearFrame());

    assert.deepEqual(out, { ok: false, reason: 'dead' });
    assert.deepEqual(p.m_vPos, before); // position unchanged
    assert.equal(broadcasts.length, 0); // no echo
  });

  it('applyBehavior drops a dead player (reason dead) without broadcasting', () => {
    const { svc, broadcasts } = makeService();
    const p = makePlayer();
    p.m_bDead = true;

    const out = svc.applyBehavior(p, nearFrame());

    assert.deepEqual(out, { ok: false, reason: 'dead' });
    assert.equal(broadcasts.length, 0);
  });

  it('applyCorr drops a dead player (reason dead) without moving or broadcasting', () => {
    const { svc, broadcasts } = makeService();
    const p = makePlayer();
    p.m_bDead = true;
    const before = { ...p.m_vPos };

    const out = svc.applyCorr(p, nearFrame());

    assert.deepEqual(out, { ok: false, reason: 'dead' });
    assert.deepEqual(p.m_vPos, before);
    assert.equal(broadcasts.length, 0);
  });

  it('applyMoved2 drops a dead player (reason dead) without moving or broadcasting', () => {
    const { svc, broadcasts } = makeService();
    const p = makePlayer();
    p.m_bDead = true;
    const before = { ...p.m_vPos };

    const out = svc.applyMoved2(p, near2Frame());

    assert.deepEqual(out, { ok: false, reason: 'dead' });
    assert.deepEqual(p.m_vPos, before);
    assert.equal(broadcasts.length, 0);
  });

  it('applyMovement still moves a live player within the anti-teleport radius', () => {
    const { svc, broadcasts } = makeService();
    const p = makePlayer();

    const out = svc.applyMovement(p, nearFrame(10));

    assert.equal(out.ok, true);
    assert.equal(p.m_vPos.x, 10);
    assert.equal(broadcasts.length, 1);
  });

  it('applyBehavior still echoes for a live player', () => {
    const { svc, broadcasts } = makeService();
    const p = makePlayer();

    const out = svc.applyBehavior(p, nearFrame());

    assert.equal(out.ok, true);
    assert.equal(broadcasts.length, 1);
  });
});

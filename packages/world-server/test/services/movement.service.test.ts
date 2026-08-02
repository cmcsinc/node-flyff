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
import { OBJSTAF } from '@flyff/entities';
import { NULL_ID } from '@flyff/world-core';
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

/**
 * Follow visibility regression: player A follows B, B must keep seeing A walk.
 *
 * The client clears its own `m_idDest` on arrival (`MoverMove.cpp:267`) and
 * re-issues PLAYERSETDESTOBJ for the SAME target every frame the leader is
 * further than `distSq > 16` (`WndWorldControlPlayer.cpp:405-416`). A
 * `__TRAFIC_1222`-style dedup on the stored dest therefore swallowed every hop
 * after the first, freezing the follower on the observer's screen.
 */
describe('MovementService dest-obj follow', () => {
  const LEADER = 77;

  it('broadcasts MOVERSETDESTOBJ on a repeat PLAYERSETDESTOBJ for the same target', () => {
    const { svc, broadcasts } = makeService();
    const p = makePlayer();

    const first = svc.applySetDestObj(p, LEADER, 0);
    const second = svc.applySetDestObj(p, LEADER, 0);

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(broadcasts.length, 2, 're-issue must reach peers, not be deduped');
    assert.equal(p.m_idDestObj, LEADER);
  });

  it('records the dest obj + arrival range', () => {
    const { svc } = makeService();
    const p = makePlayer();

    svc.applySetDestObj(p, LEADER, 2.5);

    assert.equal(p.m_idDestObj, LEADER);
    assert.equal(p.m_fArrivalRange, 2.5);
  });

  it('PLAYERMOVED clears the dest obj (CMover::SetDestPos -> ClearDestObj)', () => {
    const { svc } = makeService();
    const p = makePlayer();
    svc.applySetDestObj(p, LEADER, 0);

    svc.applyMovement(p, nearFrame(3));

    assert.equal(p.m_idDestObj, NULL_ID);
    assert.equal(p.m_fArrivalRange, 0);
  });

  it('PLAYERCORR clears the dest obj (OnPlayerCorr -> ClearDest)', () => {
    const { svc } = makeService();
    const p = makePlayer();
    svc.applySetDestObj(p, LEADER, 0);

    svc.applyCorr(p, nearFrame(3));

    assert.equal(p.m_idDestObj, NULL_ID);
  });

  it('PLAYERBEHAVIOR leaves the dest obj alone (__SYNC_1217 clears pos dest only)', () => {
    const { svc } = makeService();
    const p = makePlayer();
    svc.applySetDestObj(p, LEADER, 0);

    svc.applyBehavior(p, nearFrame());

    assert.equal(p.m_idDestObj, LEADER);
  });

  it('a dropped movement frame (anti-teleport) does not clear the dest obj', () => {
    const { svc } = makeService();
    const p = makePlayer();
    svc.applySetDestObj(p, LEADER, 0);

    const out = svc.applyMovement(p, nearFrame(100_000));

    assert.deepEqual(out, { ok: false, reason: 'too_far' });
    assert.equal(p.m_idDestObj, LEADER);
  });
});


describe("MovementService flight gate (symmetric)", () => {
  it("applyMovement drops a flying player (reason flying)", () => {
    const { svc, broadcasts } = makeService();
    const p = makePlayer();
    p.m_dwStateFlag |= OBJSTAF.FLY;
    const out = svc.applyMovement(p, nearFrame());
    assert.deepEqual(out, { ok: false, reason: "flying" });
    assert.equal(broadcasts.length, 0);
  });

  it("applyMoved2 drops a grounded player (reason not_flying)", () => {
    const { svc, broadcasts } = makeService();
    const p = makePlayer();
    const out = svc.applyMoved2(p, near2Frame());
    assert.deepEqual(out, { ok: false, reason: "not_flying" });
    assert.equal(broadcasts.length, 0);
  });

  it("applyMoved2 accepts a flying player within anti-teleport radius", () => {
    const { svc, broadcasts } = makeService();
    const p = makePlayer();
    p.m_dwStateFlag |= OBJSTAF.FLY;
    const out = svc.applyMoved2(p, near2Frame(10));
    assert.equal(out.ok, true);
    assert.equal(broadcasts.length, 1);
  });

  it("applyAngle drops a grounded player (reason not_flying)", () => {
    const { svc } = makeService();
    const p = makePlayer();
    const out = svc.applyAngle(p, { v: { x: 0, y: 0, z: 0 }, vd: { x: 0, y: 0, z: 0 }, f: 0, fAngleX: 0.1, fAccPower: 0, fTurnAngle: 0, nTickCount: 0n });
    assert.deepEqual(out, { ok: false, reason: "not_flying" });
  });
});

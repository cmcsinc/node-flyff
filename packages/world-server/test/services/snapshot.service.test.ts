/**
 * SnapshotService (inbound DESTPOS / click-to-move) unit tests.
 *
 * Covers the anti-teleport guard and the `CMover::SetDestPos -> ClearDestObj()`
 * tail (`_Common/MoverMsg.cpp:105`), reached by `OnPlayerDestPos`
 * (DPSrvr.cpp:4458): click-to-move cancels an in-progress follow server-side,
 * so a stale dest obj cannot be reported to a late-arriving observer.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { SnapshotService } from '../../src/services/snapshot.service';
import { CPlayer } from '@flyff/entities';
import { NULL_ID } from '@flyff/world-core';
import type { CharacterRow } from '@flyff/database';

function makePlayer(): CPlayer {
  return CPlayer.fromRow({
    id: 1, account_id: 1, name: 'Tester', slot: 0, class: 0, gender: 0,
    hair_style: 0, hair_color: 0, face_style: 0, skin_color: 0,
    level: 1, exp: 0n, hp: 200, mp: 100, max_hp: 200, max_mp: 100,
    strength: 15, stamina: 15, dexterity: 15, intelligence: 15,
    x: 0, y: 0, z: 0, world_id: 'flaris', zone_id: 1,
    created_at: new Date(), updated_at: new Date(),
  } as CharacterRow, { write: () => true });
}

function makeService() {
  const broadcasts: Buffer[] = [];
  const svc = new SnapshotService({
    zoneManager: {
      broadcastAround: (_p, _z, _r, packet: Buffer) => { broadcasts.push(packet); return 1; },
    } as never,
  });
  return { svc, broadcasts };
}

const frame = (x: number) => ({ vPos: { x, y: 0, z: 0 }, fForward: 1 });

describe('SnapshotService destPos', () => {
  it('moves the player and echoes to peers', () => {
    const { svc, broadcasts } = makeService();
    const p = makePlayer();

    const out = svc.destPos(p, frame(12));

    assert.deepEqual(out, { ok: true, reached: 1 });
    assert.equal(p.m_vPos.x, 12);
    assert.equal(broadcasts.length, 1);
  });

  it('drops a teleport-class jump without moving or echoing', () => {
    const { svc, broadcasts } = makeService();
    const p = makePlayer();

    const out = svc.destPos(p, frame(100_000));

    assert.deepEqual(out, { ok: false, reason: 'too_far' });
    assert.equal(p.m_vPos.x, 0);
    assert.equal(broadcasts.length, 0);
  });

  it('clears an in-progress follow (SetDestPos -> ClearDestObj)', () => {
    const { svc } = makeService();
    const p = makePlayer();
    p.m_idDestObj = 77;
    p.m_fArrivalRange = 2.5;

    svc.destPos(p, frame(5));

    assert.equal(p.m_idDestObj, NULL_ID);
    assert.equal(p.m_fArrivalRange, 0);
  });

  it('leaves the dest obj alone when the frame is dropped', () => {
    const { svc } = makeService();
    const p = makePlayer();
    p.m_idDestObj = 77;

    svc.destPos(p, frame(100_000));

    assert.equal(p.m_idDestObj, 77);
  });
});

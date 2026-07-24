import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { SessionState } from '@flyff/core/constants/sessionState';
import { RangeAttackHandler } from '../../src/handlers/rangeAttack.handler';
import type { RangeAttackService, RangeAttackOutcome } from '../../src/services/rangeAttack.service';
import type { RangeAttackFrame } from '../../src/net/snapshot/rangeAttack.serializer';
import type { PlayerManager } from '@flyff/world-core';
import type { CPlayer } from '@flyff/entities';

function mockSocket(state = SessionState.IN_WORLD) {
  let destroyed = false;
  return {
    session: { state, charId: 42 },
    write: () => true,
    destroy: () => { destroyed = true; },
    get _destroyed() { return destroyed; },
  };
}

/** Build the 20-byte RANGE_ATTACK body: dwAtkMsg, objid, nParam2, nParam3, fVal. */
const payload = (dwAtkMsg: number, objid: number, nParam2: number, nParam3: number, fVal: number) => {
  const w = new PacketWriter();
  w.writeDword(dwAtkMsg);
  w.writeDword(objid);
  w.writeLong(nParam2);
  w.writeLong(nParam3);
  w.writeFloat(fVal);
  return w.build();
};

const fakePm = (p?: CPlayer): PlayerManager => ({ get: () => p }) as unknown as PlayerManager;
const fakeSvc = (r: RangeAttackOutcome): RangeAttackService =>
  ({ attack: () => r }) as unknown as RangeAttackService;
const player = { m_idPlayer: 42, m_bDead: false, isStunned: () => false } as unknown as CPlayer;

describe('RangeAttackHandler', () => {
  it('parses the 20-byte body and derives idSfxHit from HIWORD(nParam3)', () => {
    let got: RangeAttackFrame | null = null;
    const svc = {
      attack: (_p: CPlayer, f: RangeAttackFrame) => { got = f; return { ok: true, reached: 0 }; },
    } as unknown as RangeAttackService;
    const handler = new RangeAttackHandler(fakePm(player), svc);
    // nParam3 = 0x00070003 -> HIWORD = 7 -> idSfxHit 7.
    handler.handleRangeAttack(mockSocket() as never, new PacketReader(payload(35, 0x40000005, 0, 0x00070003, 2.0)));
    assert.deepEqual(got, { dwAtkMsg: 35, objid: 0x40000005, nParam2: 0, nParam3: 0x00070003, idSfxHit: 7 });
  });

  it('destroys when not IN_WORLD', () => {
    const handler = new RangeAttackHandler(fakePm(player), fakeSvc({ ok: true, reached: 0 }));
    const sock = mockSocket(SessionState.CONNECTED);
    handler.handleRangeAttack(sock as never, new PacketReader(payload(35, 1, 0, 0, 1)));
    assert.equal(sock._destroyed, true);
  });

  it('drops silently on rejected (NULL_ID target) outcome', () => {
    const handler = new RangeAttackHandler(fakePm(player), fakeSvc({ ok: false, reason: 'invalid_target' }));
    const sock = mockSocket();
    handler.handleRangeAttack(sock as never, new PacketReader(payload(35, 0xffffffff, 0, 0, 1)));
    assert.equal(sock._destroyed, false);
  });
});

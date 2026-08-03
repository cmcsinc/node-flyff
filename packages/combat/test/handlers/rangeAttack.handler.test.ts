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

/** Build the 16-byte RANGE_ATTACK body: dwAtkMsg, objid, dwItemID, idSfxHit. */
const payload = (dwAtkMsg: number, objid: number, dwItemID: number, idSfxHit: number) => {
  const w = new PacketWriter();
  w.writeDword(dwAtkMsg);
  w.writeDword(objid);
  w.writeDword(dwItemID);
  w.writeDword(idSfxHit);
  return w.build();
};

const fakePm = (p?: CPlayer): PlayerManager => ({ get: () => p }) as unknown as PlayerManager;
const fakeSvc = (r: RangeAttackOutcome): RangeAttackService =>
  ({ attack: () => r }) as unknown as RangeAttackService;
const player = { m_idPlayer: 42, m_bDead: false, isStunned: () => false } as unknown as CPlayer;

describe('RangeAttackHandler', () => {
  it('parses the 16-byte body and remaps to the AddRangeAttack broadcast shape', () => {
    let got: RangeAttackFrame | null = null;
    const svc = {
      attack: (_p: CPlayer, f: RangeAttackFrame) => { got = f; return { ok: true, reached: 0 }; },
    } as unknown as RangeAttackService;
    const handler = new RangeAttackHandler(fakePm(player), svc);
    // Received: dwAtkMsg=35, objid, dwItemID=431, idSfxHit=7.
    // Broadcast (AddRangeAttack, User.cpp:4850): nParam2=dwItemID, nParam3=0, idSfxHit passthrough.
    handler.handleRangeAttack(mockSocket() as never, new PacketReader(payload(35, 0x40000005, 431, 7)));
    assert.deepEqual(got, { dwAtkMsg: 35, objid: 0x40000005, nParam2: 431, nParam3: 0, idSfxHit: 7 });
  });

  it('does NOT read a trailing fVal (range packet is 16 bytes, not the 20-byte melee body)', () => {
    // A 16-byte buffer must parse cleanly. If the handler read a 5th float it
    // would over-run -> PacketError -> silent drop (the original ranged-bug).
    let called = false;
    const svc = { attack: () => { called = true; return { ok: true, reached: 0 }; } } as unknown as RangeAttackService;
    const handler = new RangeAttackHandler(fakePm(player), svc);
    handler.handleRangeAttack(mockSocket() as never, new PacketReader(payload(35, 0x40000005, 431, 7)));
    assert.equal(called, true, 'service must be reached on the 16-byte body');
  });

  it('destroys when not IN_WORLD', () => {
    const handler = new RangeAttackHandler(fakePm(player), fakeSvc({ ok: true, reached: 0 }));
    const sock = mockSocket(SessionState.CONNECTED);
    handler.handleRangeAttack(sock as never, new PacketReader(payload(35, 1, 0, 0)));
    assert.equal(sock._destroyed, true);
  });

  it('drops silently on rejected (NULL_ID target) outcome', () => {
    const handler = new RangeAttackHandler(fakePm(player), fakeSvc({ ok: false, reason: 'invalid_target' }));
    const sock = mockSocket();
    handler.handleRangeAttack(sock as never, new PacketReader(payload(35, 0xffffffff, 0, 0)));
    assert.equal(sock._destroyed, false);
  });
});

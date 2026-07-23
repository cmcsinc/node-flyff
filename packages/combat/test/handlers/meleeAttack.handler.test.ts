import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { SessionState } from '@flyff/core/constants/sessionState';
import { MeleeAttackHandler } from '../../src/handlers/meleeAttack.handler';
import type { MeleeAttackService, MeleeAttackOutcome } from '../../src/services/meleeAttack.service';
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

/** Build the 20-byte MELEE_ATTACK body: dwAtkMsg, objid, nParam2, nParam3, fVal. */
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
const fakeSvc = (r: MeleeAttackOutcome): MeleeAttackService =>
  ({ attack: () => r }) as unknown as MeleeAttackService;
const player = { m_idPlayer: 42 } as unknown as CPlayer;

describe('MeleeAttackHandler', () => {
  it('parses the 20-byte body (incl. __HACK_1023 trailing float) and delegates', () => {
    let got: { dwAtkMsg: number; objid: number; nParam2: number; nParam3: number } | null = null;
    const svc = {
      attack: (_p: CPlayer, f: { dwAtkMsg: number; objid: number; nParam2: number; nParam3: number }) => {
        got = f;
        return { ok: true, reached: 0 };
      },
    } as unknown as MeleeAttackService;
    const handler = new MeleeAttackHandler(fakePm(player), svc);
    handler.handleMeleeAttack(mockSocket() as never, new PacketReader(payload(29, 0x40000005, 0, 0, 2.0)));
    assert.deepEqual(got, { dwAtkMsg: 29, objid: 0x40000005, nParam2: 0, nParam3: 0 });
  });

  it('destroys when not IN_WORLD', () => {
    const handler = new MeleeAttackHandler(fakePm(player), fakeSvc({ ok: true, reached: 0 }));
    const sock = mockSocket(SessionState.CONNECTED);
    handler.handleMeleeAttack(sock as never, new PacketReader(payload(29, 1, 0, 0, 1)));
    assert.equal(sock._destroyed, true);
  });

  it('drops silently on rejected (NULL_ID target) outcome', () => {
    const handler = new MeleeAttackHandler(fakePm(player), fakeSvc({ ok: false, reason: 'invalid_target' }));
    const sock = mockSocket();
    handler.handleMeleeAttack(sock as never, new PacketReader(payload(29, 0xffffffff, 0, 0, 1)));
    assert.equal(sock._destroyed, false);
  });
});

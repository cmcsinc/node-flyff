import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { SessionState } from '@flyff/core/constants/sessionState';
import { SetTargetHandler } from '../../src/handlers/setTarget.handler';
import type { TargetService, SetTargetOutcome } from '../../src/services/target.service';
import type { PlayerManager } from '../../src/managers/player.manager';
import type { CPlayer } from '../../src/entities/player';

function mockSocket(state = SessionState.IN_WORLD) {
  let destroyed = false;
  return {
    session: { state, charId: 42 },
    write: () => true,
    destroy: () => { destroyed = true; },
    get _destroyed() { return destroyed; },
  };
}

const payload = (idTarget: number, bClear: number) => {
  const w = new PacketWriter();
  w.writeDword(idTarget);
  w.writeByte(bClear);
  return w.build();
};

const fakePm = (p?: CPlayer): PlayerManager => ({ get: () => p }) as unknown as PlayerManager;
const fakeSvc = (r: SetTargetOutcome): TargetService =>
  ({ setTarget: () => r }) as unknown as TargetService;
const player = { m_idPlayer: 42 } as unknown as CPlayer;

describe('SetTargetHandler', () => {
  it('passes idTarget + bClear to the service', () => {
    let got: { id: number; clear: number } | null = null;
    const svc = {
      setTarget: (_p: CPlayer, id: number, clear: number) => { got = { id, clear }; return { ok: true, mode: 'set_objective' as const }; },
    } as unknown as TargetService;
    const handler = new SetTargetHandler(fakePm(player), svc);
    handler.handleSetTarget(mockSocket() as never, new PacketReader(payload(0x1234, 2)));
    assert.deepEqual(got, { id: 0x1234, clear: 2 });
  });

  it('destroys when not IN_WORLD', () => {
    const handler = new SetTargetHandler(fakePm(player), fakeSvc({ ok: true, mode: 'noop' }));
    const sock = mockSocket(SessionState.CONNECTED);
    handler.handleSetTarget(sock as never, new PacketReader(payload(1, 0)));
    assert.equal(sock._destroyed, true);
  });

  it('drops silently on rejected outcome', () => {
    const handler = new SetTargetHandler(fakePm(player), fakeSvc({ ok: false, reason: 'invalid_clear' }));
    const sock = mockSocket();
    handler.handleSetTarget(sock as never, new PacketReader(payload(1, 9)));
    assert.equal(sock._destroyed, false);
  });
});

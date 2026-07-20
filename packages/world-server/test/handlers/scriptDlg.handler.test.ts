import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { ScriptDlgHandler } from '../../src/handlers/scriptDlg.handler.js';
import type { ScriptDlgService, ScriptDlgOutcome } from '../../src/services/scriptDlg.service.js';
import type { PlayerManager } from '../../src/managers/player.manager.js';
import type { CPlayer } from '../../src/entities/player.js';

function mockSocket(state = SessionState.IN_WORLD) {
  let destroyed = false;
  return {
    session: { state, charId: 42 },
    write: () => true,
    destroy: () => { destroyed = true; },
    get _destroyed() { return destroyed; },
  };
}

const payload = (objid: number, key: string, g1: number, g2: number, g3: number, g4: number) => {
  const w = new PacketWriter();
  w.writeDword(objid);
  w.writeString(key);
  w.writeLong(g1); w.writeLong(g2); w.writeLong(g3); w.writeLong(g4);
  return w.build();
};

const fakePm = (p?: CPlayer): PlayerManager => ({ get: () => p }) as unknown as PlayerManager;
const fakeSvc = (r: ScriptDlgOutcome): ScriptDlgService =>
  ({ dialog: () => r }) as unknown as ScriptDlgService;
const player = { m_idPlayer: 42 } as unknown as CPlayer;

describe('ScriptDlgHandler', () => {
  it('parses objid + key + 4 globals and delegates', () => {
    let captured: { key: string; g: number[] } | null = null;
    const svc = {
      dialog: (_p: CPlayer, f: { key: string; nGlobal1: number; nGlobal2: number; nGlobal3: number; nGlobal4: number }) => {
        captured = { key: f.key, g: [f.nGlobal1, f.nGlobal2, f.nGlobal3, f.nGlobal4] };
        return { ok: true };
      },
    } as unknown as ScriptDlgService;
    const handler = new ScriptDlgHandler(fakePm(player), svc);
    handler.handleScriptDlg(mockSocket() as never, new PacketReader(payload(1, 'init', 2, 3, 4, 5)));
    assert.deepEqual(captured, { key: 'init', g: [2, 3, 4, 5] });
  });

  it('destroys when not IN_WORLD', () => {
    const handler = new ScriptDlgHandler(fakePm(player), fakeSvc({ ok: true }));
    const sock = mockSocket(SessionState.CONNECTED);
    handler.handleScriptDlg(sock as never, new PacketReader(payload(1, 'k', 0, 0, 0, 0)));
    assert.equal(sock._destroyed, true);
  });

  it('drops silently on rate-limited outcome', () => {
    const handler = new ScriptDlgHandler(fakePm(player), fakeSvc({ ok: false, reason: 'rate_limited' }));
    const sock = mockSocket();
    handler.handleScriptDlg(sock as never, new PacketReader(payload(1, 'k', 0, 0, 0, 0)));
    assert.equal(sock._destroyed, false);
  });
});

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { ScriptDlgHandler } from '../../src/handlers/scriptDlg.handler.js';
import type { ScriptDlgService, ScriptDlgResult } from '../../src/services/scriptDlg.service.js';
import type { PlayerManager } from '../../src/managers/player.manager.js';
import type { CPlayer } from '../../src/entities/player.js';

function mockSocket(state = SessionState.IN_WORLD) {
  const written: Buffer[] = [];
  let destroyed = false;
  return {
    session: { state, charId: 42 },
    write: (b: Buffer) => { written.push(b); return true; },
    destroy: () => { destroyed = true; },
    get _destroyed() { return destroyed; },
    get _written() { return written; },
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
const fakeSvc = (r: ScriptDlgResult): ScriptDlgService =>
  ({ dialog: async () => r }) as unknown as ScriptDlgService;
const player = { m_idPlayer: 42 } as unknown as CPlayer;

describe('ScriptDlgHandler', () => {
  it('parses objid + key + 4 globals and delegates', async () => {
    let captured: { key: string; g: number[] } | null = null;
    const svc = {
      dialog: async (_p: CPlayer, f: { key: string; nGlobal1: number; nGlobal2: number; nGlobal3: number; nGlobal4: number }) => {
        captured = { key: f.key, g: [f.nGlobal1, f.nGlobal2, f.nGlobal3, f.nGlobal4] };
        return { ok: true, frames: [] };
      },
    } as unknown as ScriptDlgService;
    const handler = new ScriptDlgHandler(fakePm(player), svc);
    await handler.handleScriptDlg(mockSocket() as never, new PacketReader(payload(1, 'init', 2, 3, 4, 5)));
    assert.deepEqual(captured, { key: 'init', g: [2, 3, 4, 5] });
  });

  it('writes every frame the service returns', async () => {
    const a = Buffer.from([0xaa]);
    const b = Buffer.from([0xbb]);
    const sock = mockSocket();
    await new ScriptDlgHandler(fakePm(player), fakeSvc({ ok: true, frames: [a, b] }))
      .handleScriptDlg(sock as never, new PacketReader(payload(1, 'k', 0, 0, 0, 0)));
    assert.deepEqual(sock._written, [a, b]);
  });

  it('destroys when not IN_WORLD', async () => {
    const sock = mockSocket(SessionState.CONNECTED);
    await new ScriptDlgHandler(fakePm(player), fakeSvc({ ok: true, frames: [] }))
      .handleScriptDlg(sock as never, new PacketReader(payload(1, 'k', 0, 0, 0, 0)));
    assert.equal(sock._destroyed, true);
  });

  it('drops silently on rate-limited outcome', async () => {
    const sock = mockSocket();
    await new ScriptDlgHandler(fakePm(player), fakeSvc({ ok: false, reason: 'rate_limited' }))
      .handleScriptDlg(sock as never, new PacketReader(payload(1, 'k', 0, 0, 0, 0)));
    assert.equal(sock._destroyed, false);
    assert.equal(sock._written.length, 0);
  });
});

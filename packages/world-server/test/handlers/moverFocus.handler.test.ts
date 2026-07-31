import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { SessionState } from '@flyff/core/constants/sessionState';
import { MoverFocusHandler } from '../../src/handlers/moverFocus.handler';
import { MoverFocusService } from '../../src/services/moverFocus.service';
import { MoverFocusSerializer } from '../../src/net/snapshot/moverFocus.serializer';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID, SNAPSHOTTYPE_MOVERFOCUS } from '@flyff/world-core';
import type { PlayerManager } from '@flyff/world-core';
import { AUTH } from '@flyff/entities';
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

const payload = (uid: number) => {
  const w = new PacketWriter();
  w.writeDword(uid);
  return w.build();
};

const gm = { m_idPlayer: 42, m_szName: 'gm', m_bAuthority: AUTH.GAMEMASTER, m_nGold: 0, m_nExp: 0 } as unknown as CPlayer;
const peer = { m_idPlayer: 7, m_szName: 'bob', m_bAuthority: AUTH.GENERAL, m_nGold: 1234, m_nExp: 555 } as unknown as CPlayer;

function fakePm(players: Record<number, CPlayer>, sent: Buffer[]): PlayerManager {
  return {
    get: (id: number) => players[id],
    sendTo: (_p: CPlayer, b: Buffer) => { sent.push(b); },
  } as unknown as PlayerManager;
}

describe('MoverFocusHandler', () => {
  it('replies with the focused player gold + exp for a GM', () => {
    const sent: Buffer[] = [];
    const pm = fakePm({ 42: gm, 7: peer }, sent);
    const handler = new MoverFocusHandler(pm, new MoverFocusService({ playerManager: pm }));
    const sock = mockSocket();
    handler.handleMoverFocus(sock as never, new PacketReader(payload(7)));
    assert.equal(sock._destroyed, false);
    assert.equal(sent.length, 1);
    // PacketWriter.build() emits the raw payload; framing happens at the socket
    // write boundary (memory `broadcast-must-frame-at-write-boundary`).
    const r = new PacketReader(sent[0]!);
    assert.equal(r.readDword(), PACKETTYPE.SNAPSHOT);
    assert.equal(r.readDword(), NULL_ID);
    assert.equal(r.readWord(), 1);
    assert.equal(r.readDword(), NULL_ID);            // objid slot is NULL_ID
    assert.equal(r.readWord(), SNAPSHOTTYPE_MOVERFOCUS);
    assert.equal(r.readDword(), 7);
    assert.equal(r.readDword(), 1234);
  });

  it('drops a non-GM request (server-side auth, C++ does not check)', () => {
    const sent: Buffer[] = [];
    const plain = { ...gm, m_bAuthority: AUTH.GENERAL } as unknown as CPlayer;
    const pm = fakePm({ 42: plain, 7: peer }, sent);
    const handler = new MoverFocusHandler(pm, new MoverFocusService({ playerManager: pm }));
    const sock = mockSocket();
    handler.handleMoverFocus(sock as never, new PacketReader(payload(7)));
    assert.equal(sent.length, 0);
    assert.equal(sock._destroyed, false);
  });

  it('drops an unknown uidPlayer', () => {
    const sent: Buffer[] = [];
    const pm = fakePm({ 42: gm }, sent);
    const handler = new MoverFocusHandler(pm, new MoverFocusService({ playerManager: pm }));
    handler.handleMoverFocus(mockSocket() as never, new PacketReader(payload(999)));
    assert.equal(sent.length, 0);
  });

  it('destroys when not IN_WORLD', () => {
    const sent: Buffer[] = [];
    const pm = fakePm({ 42: gm }, sent);
    const handler = new MoverFocusHandler(pm, new MoverFocusService({ playerManager: pm }));
    const sock = mockSocket(SessionState.CONNECTED);
    handler.handleMoverFocus(sock as never, new PacketReader(payload(7)));
    assert.equal(sock._destroyed, true);
  });

  it('drops a truncated payload without destroying', () => {
    const sent: Buffer[] = [];
    const pm = fakePm({ 42: gm }, sent);
    const handler = new MoverFocusHandler(pm, new MoverFocusService({ playerManager: pm }));
    const sock = mockSocket();
    const w = new PacketWriter();
    w.writeWord(1);
    handler.handleMoverFocus(sock as never, new PacketReader(w.build()));
    assert.equal(sock._destroyed, false);
    assert.equal(sent.length, 0);
  });
});

describe('MoverFocusSerializer', () => {
  it('writes exp as a 64-bit field (22B payload, unframed)', () => {
    const buf = new MoverFocusSerializer().build({ uidPlayer: 7, gold: 1, exp: 2 });
    // 4 opcode + 4 NULL_ID + 2 count + 4 objid + 2 subtype + 4 uid + 4 gold + 8 exp
    assert.equal(buf.length, 4 + 4 + 2 + 4 + 2 + 4 + 4 + 8);
  });
});

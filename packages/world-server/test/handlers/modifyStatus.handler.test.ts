import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { CPlayer } from '../../src/entities/player.js';
import { ModifyStatusHandler } from '../../src/handlers/modifyStatus.handler.js';
import { StatService } from '../../src/services/stat.service.js';
import type { CharacterRow } from '@flyff/database';

function makeRow(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 42, account_id: 7, name: 'TestHero', slot: 0, class: 1, gender: 0,
    hair_style: 2, hair_color: 0, face_style: 3, skin_color: 1,
    level: 15, exp: 0n, hp: 100, mp: 50, max_hp: 100, max_mp: 50,
    strength: 15, stamina: 15, dexterity: 15, intelligence: 15, remain_gp: 5,
    x: 0, y: 0, z: 0, world_id: 'MADRIGAL', zone_id: 1,
    created_at: new Date(), updated_at: new Date(), ...over,
  };
}

function makeSocket(state = SessionState.IN_WORLD) {
  const destroyed: boolean[] = [];
  return {
    session: { state, charId: 42 },
    write: () => true,
    destroy: () => { destroyed.push(true); },
    _destroyed: destroyed,
  } as never;
}

/** MODIFY_STATUS payload: 4 DWORDs (str/sta/dex/int counts). */
function body(str: number, sta: number, dex: number, int: number): Buffer {
  const w = new PacketWriter();
  w.writeDword(str); w.writeDword(sta); w.writeDword(dex); w.writeDword(int);
  return w.build();
}

function makeHandler(player: CPlayer) {
  const sent: Buffer[] = [];
  const playerManager = {
    get: () => player,
    sendTo: (_p: unknown, b: Buffer) => { sent.push(b); },
  };
  const statService = new StatService({
    playerManager,
    charRepo: { updateStats: async () => {} },
    journal: { append: () => 0 },
  });
  const handler = new ModifyStatusHandler(playerManager as never, statService);
  return { handler, sent };
}

describe('ModifyStatusHandler', () => {
  it('parses 4 DWORDs and applies the allocation', () => {
    const p = CPlayer.fromRow(makeRow(), { write: () => true } as never);
    const { handler, sent } = makeHandler(p);
    handler.handleModifyStatus(makeSocket(), new PacketReader(body(2, 0, 0, 0)));
    assert.equal(p.m_nStr, 17);
    assert.equal(p.m_nRemainGP, 3);
    assert.equal(sent.length, 1, 'SETSTATE echoed');
  });

  it('destroys the socket when not IN_WORLD', () => {
    const p = CPlayer.fromRow(makeRow(), { write: () => true } as never);
    const { handler } = makeHandler(p);
    const sock = makeSocket(SessionState.IN_CLUSTER);
    handler.handleModifyStatus(sock, new PacketReader(body(1, 0, 0, 0)));
    assert.equal((sock as unknown as { _destroyed: boolean[] })._destroyed.length, 1);
    assert.equal(p.m_nRemainGP, 5, 'unchanged');
  });

  it('rejects over-spend without throwing (service returns insufficient)', () => {
    const p = CPlayer.fromRow(makeRow(), { write: () => true } as never);
    const { handler, sent } = makeHandler(p);
    handler.handleModifyStatus(makeSocket(), new PacketReader(body(99, 0, 0, 0)));
    assert.equal(p.m_nStr, 15, 'unchanged');
    assert.equal(p.m_nRemainGP, 5, 'unchanged');
    assert.equal(sent.length, 0, 'no echo on reject');
  });
});

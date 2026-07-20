import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { PacketBuffer } from '@flyff/core/net/PacketBuffer.js';
import { JoinHandler } from '../../src/handlers/join.handler.js';
import { PlayerSnapshotSerializer } from '../../src/net/snapshot/playerSnapshot.serializer.js';
import type { JoinService, JoinOutcome } from '../../src/services/join.service.js';
import { CPlayer } from '../../src/entities/player.js';
import type { CharacterRow } from '@flyff/database';

function makeRow(): CharacterRow {
  return {
    id: 42, account_id: 7, name: 'Hero', slot: 0, class: 1, gender: 0,
    hair_style: 0, hair_color: 0, face_style: 0, skin_color: 0, level: 1,
    exp: 0n, hp: 100, mp: 50, max_hp: 100, max_mp: 50,
    strength: 15, stamina: 15, dexterity: 15, intelligence: 15,
    x: 0, y: 0, z: 0, world_id: 'W1', zone_id: 1,
    created_at: new Date(), updated_at: new Date(),
  };
}

function mockSocket() {
  const written: Buffer[] = [];
  const sink = new PacketBuffer();
  let destroyed = false;
  return {
    write: (b: Buffer) => { sink.push(b); for (const p of sink.drain()) written.push(p); return true; },
    destroy: () => { destroyed = true; },
    _written: written,
    get _destroyed() { return destroyed; },
  };
}

/** Build a client→cache JOIN payload (Neuz/DPClient.cpp:8959 field order). */
function joinPayload(idPlayer: number, nSlot: number): Buffer {
  const w = new PacketWriter();
  w.writeDword(1);                // dwWorldId
  w.writeDword(idPlayer);
  w.writeDword(0xdeadbeef);       // dwAuthKey
  w.writeDword(0);                // idParty
  w.writeDword(0);                // idGuild
  w.writeDword(0);                // idWar
  w.writeDword(0);                // uChannel
  w.writeByte(nSlot);
  w.writeString('Hero');          // name
  w.writeString('acct');
  w.writeString('pw');
  return w.build();
}

function fakeJoinService(outcome: JoinOutcome): JoinService {
  return { join: async () => outcome } as unknown as JoinService;
}

describe('JoinHandler', () => {
  const snapshotSerializer = new PlayerSnapshotSerializer();

  it('writes the self-spawn snapshot on a successful join', async () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    const handler = new JoinHandler(fakeJoinService({ ok: true, player }), snapshotSerializer);
    const sock = mockSocket();

    await handler.handleJoin(sock as unknown as never, new PacketReader(joinPayload(42, 0)));

    assert.equal(sock._written.length, 1);
    assert.equal(sock._written[0]!.length, 3354); // WORLD_READINFO + "Hero" snapshot (3350 base + 4)
    assert.equal(sock._destroyed, false);
  });

  it('destroys the socket when the join is rejected', async () => {
    const handler = new JoinHandler(
      fakeJoinService({ ok: false, reason: 'bad_token' }),
      snapshotSerializer,
    );
    const sock = mockSocket();

    await handler.handleJoin(sock as unknown as never, new PacketReader(joinPayload(42, 0)));

    assert.equal(sock._written.length, 0);
    assert.equal(sock._destroyed, true);
  });

  it('rejects nSlot >= 3 without calling the service', async () => {
    let called = false;
    const svc = {
      join: async () => { called = true; return { ok: false, reason: 'bad_token' as const }; },
    } as unknown as JoinService;
    const handler = new JoinHandler(svc, snapshotSerializer);
    const sock = mockSocket();

    await handler.handleJoin(sock as unknown as never, new PacketReader(joinPayload(42, 5)));

    assert.equal(called, false);
    assert.equal(sock._destroyed, true);
  });
});

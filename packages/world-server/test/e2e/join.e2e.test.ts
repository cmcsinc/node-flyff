import { describe, it, before } from 'node:test';
import * as assert from 'node:assert/strict';
import { IpcBus } from '@flyff/ipc';
import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { PacketBuffer } from '@flyff/core/net/PacketBuffer.js';
import { ClusterListener, PLAYER_HANDOFF_CHANNEL } from '../../src/ipc/clusterListener.js';
import { PlayerManager } from '../../src/managers/player.manager.js';
import { ZoneManager } from '../../src/managers/zone.manager.js';
import { JoinService } from '../../src/services/join.service.js';
import { JoinHandler } from '../../src/handlers/join.handler.js';
import { PlayerSnapshotSerializer } from '../../src/net/snapshot/playerSnapshot.serializer.js';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import type { CharacterRepository, CharacterRow } from '@flyff/database';

/**
 * End-to-end integration of the enter-world path:
 *   cluster IpcBus.publish('player:handoff')
 *     → real IpcBus HMAC verify
 *     → ClusterListener.consumeByCharId
 *     → JoinService (fake char repo)
 *     → JoinHandler
 *     → PlayerSnapshotSerializer
 *     → mock socket receives the JOIN/ADD_OBJ snapshot.
 *
 * No layer is mocked between publish and socket write except the DB (covered
 * by @flyff/database tests). This is the byte-level proof for the slice.
 */

class FakeRedis {
  private handlers: Array<(channel: string, data: string) => void> = [];
  private subscribed = new Set<string>();
  on(event: string, handler: (channel: string, data: string) => void): void {
    if (event === 'message') this.handlers.push(handler);
  }
  async publish(channel: string, data: string): Promise<number> {
    if (this.subscribed.has(channel)) for (const h of this.handlers) h(channel, data);
    return 1;
  }
  async subscribe(channel: string): Promise<void> { this.subscribed.add(channel); }
  async unsubscribe(channel: string): Promise<void> { this.subscribed.delete(channel); }
  async quit(): Promise<void> { this.handlers = []; }
}

const SECRET = 'e2e-secret';

function makeRow(): CharacterRow {
  return {
    id: 42, account_id: 7, name: 'Hero', slot: 0, class: 1, gender: 0,
    hair_style: 2, hair_color: 0x112233, face_style: 3, skin_color: 1, level: 15,
    exp: 0n, hp: 100, mp: 50, max_hp: 100, max_mp: 50,
    strength: 16, stamina: 15, dexterity: 14, intelligence: 13,
    x: 1.5, y: 2.5, z: 3.5, world_id: 'W1', zone_id: 1,
    created_at: new Date(), updated_at: new Date(),
  };
}

function joinPayload(idPlayer: number): Buffer {
  const w = new PacketWriter();
  w.writeDword(1);               // dwWorldId
  w.writeDword(idPlayer);
  w.writeDword(0xdeadbeef);      // dwAuthKey
  w.writeDword(0);               // idParty
  w.writeDword(0);               // idGuild
  w.writeDword(0);               // idWar
  w.writeDword(0);               // uChannel
  w.writeByte(0);                // nSlot
  w.writeString('Hero');         // name
  w.writeString('acct');
  w.writeString('pw');
  return w.build();
}

describe('E2E: cluster handoff → world JOIN → self-spawn snapshot', () => {
  let handler: JoinHandler;
  let players: PlayerManager;
  let worldBus: IpcBus;
  let clusterBus: IpcBus;
  let listener: ClusterListener;

  before(async () => {
    const redis = new FakeRedis();
    // Two buses on the same fake redis: world subscribes, cluster publishes.
    worldBus = new IpcBus(redis, SECRET, 'world-1');
    clusterBus = new IpcBus(redis, SECRET, 'cluster-1');

    const charRepo = { findById: async () => makeRow() } as unknown as CharacterRepository;
    players = new PlayerManager();
    const zones = new ZoneManager();
    listener = new ClusterListener({ bus: worldBus });
    const joinService = new JoinService({
      charRepo, playerManager: players, zoneManager: zones, handoffSource: listener,
    });
    handler = new JoinHandler(joinService, new PlayerSnapshotSerializer());
    await listener.start();
  });

  it('cluster publishes a signed handoff; world spawns + writes the snapshot', async () => {
    // 1. cluster publishes the handoff over signed IPC
    await clusterBus.publish(PLAYER_HANDOFF_CHANNEL, {
      charId: 42, token: 'tok-e2e', worldId: 'W1',
    });

    // 2. mock client socket sends JOIN for idPlayer=42
    const written: Buffer[] = [];
    const sink = new PacketBuffer();
    let destroyed = false;
    const socket = {
      write: (b: Buffer) => { sink.push(b); for (const p of sink.drain()) written.push(p); return true; },
      destroy: () => { destroyed = true; },
      _destroyed: () => destroyed,
    };

    await handler.handleJoin(socket as never, new PacketReader(joinPayload(42)));

    // 3. snapshot landed on the socket
    assert.equal(written.length, 1);
    const snap = written[0]!;
    assert.equal(snap.readUInt32LE(0), PACKETTYPE.JOIN);
    assert.equal(snap.length, 3332); // "Hero" fresh-spawn blob (3328 base + 4)
    assert.equal(snap.readUInt32LE(4), 42); // objidPlayer

    // 4. player is live in the world
    assert.ok(players.get(42));
    assert.equal(destroyed, false);
  });

  it('rejects a JOIN with no prior handoff (no socket write, socket destroyed)', async () => {
    const written: Buffer[] = [];
    const sink = new PacketBuffer();
    let destroyed = false;
    const socket = {
      write: (b: Buffer) => { sink.push(b); for (const p of sink.drain()) written.push(p); return true; },
      destroy: () => { destroyed = true; },
    };
    await handler.handleJoin(socket as never, new PacketReader(joinPayload(999)));
    assert.equal(written.length, 0);
    assert.equal(destroyed, true);
    assert.equal(players.get(999), undefined);
  });
});

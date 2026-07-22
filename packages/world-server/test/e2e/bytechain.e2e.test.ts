import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { createDb, AccountRepository, CharacterRepository } from '@flyff/database';
import { up, down } from '@flyff/database/migrations/001_initial';
import { up as upGold } from '@flyff/database/migrations/003_character_gold';
import { MemoryCache, createEventBus } from '@flyff/core';
import { hashPassword } from '@flyff/core/utils/password.js';
import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { PacketBuffer } from '@flyff/core/net/PacketBuffer.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { IpcBus } from '@flyff/ipc';

// Login-server handlers/services (cross-package).
import { AuthHandler } from '@flyff/login-server/src/handlers/auth.handler.js';
import { AuthService } from '@flyff/login-server/src/services/auth.service.js';
import { TokenService } from '@flyff/login-server/src/services/token.service.js';
import { encryptV15Password } from '@flyff/login-server/src/utils/v15Password.js';
// Cluster-server handlers/services (cross-package).
import { CharHandler } from '@flyff/cluster-server/src/handlers/char.handler.js';
import { CharListService } from '@flyff/cluster-server/src/services/charList.service.js';
import { CharCreateService } from '@flyff/cluster-server/src/services/charCreate.service.js';
import { CharSelectService } from '@flyff/cluster-server/src/services/charSelect.service.js';
import { WorldHandoffTokenService } from '@flyff/cluster-server/src/services/worldToken.service.js';
import { PlayerListSerializer } from '@flyff/cluster-server/src/net/playerList.serializer.js';
import { ClusterHandoffPublisher } from '@flyff/cluster-server/src/ipc/handoffPublisher.js';
import { AccountConnectionManager } from '@flyff/cluster-server/src/managers/accountConnection.manager.js';
// World-server (this package).
import { ClusterListener } from '../../src/ipc/clusterListener.js';
import { PlayerManager } from '../../src/managers/player.manager.js';
import { ZoneManager } from '../../src/managers/zone.manager.js';
import { SpawnManager } from '../../src/managers/spawn.manager.js';
import { JoinService } from '../../src/services/join.service.js';
import { JoinHandler } from '../../src/handlers/join.handler.js';
import { PlayerSnapshotSerializer } from '../../src/net/snapshot/playerSnapshot.serializer.js';
import { NpcSnapshotSerializer } from '../../src/net/snapshot/npcSnapshot.serializer.js';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import type { ResourceIndex, ZoneIndex } from '@flyff/resources';

/** Minimal resource index for e2e: zone 1 with one NPC (no monsters needed). */
function fixtureResources(): ResourceIndex {
  const movers = new Map<number, any>([[1006, {
    id: 1006, name: 'Homeit', name_id: 'NPC_HOMEIT', model: 'm.o3d', dwObjIndex: 12,
    scale: 1.0, type: 'npc', level: 1, hp: 1000, mp: 0, fp: 0, attack: 0, defense: 0,
    attack_rate: 0, dodge_rate: 0, speed: 0, attack_speed: 0,
    flyable: false, boss: false, giant: false, raid: false, attackable: false,
  }]]);
  const flaris = {
    _version: '1.0', _id: 'flaris', _id_numeric: 1, name: 'Flaris', name_id: 'ZONE_FLARIS',
    world_id: 'madrigal',
    bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
    revival: { position: { x: 0, y: 0, z: 0 }, radius: 1 },
    portals: [],
    npcs: [{ id: 1, mover_id: 1006, position: { x: 1, y: 1, z: 1 }, angle: 0, functions: [] }],
    spawns: [], regions: [],
  };
  const zones: ZoneIndex = {
    zones: new Map([['flaris', flaris as never]]),
    byNumericId: new Map([[1, flaris as never]]),
    byWorld: new Map([['madrigal', [flaris as never]]]),
  };
  return {
    items: { items: new Map(), byName: new Map(), byKind: new Map() },
    movers: { movers, byName: new Map(), byType: new Map() },
    skills: { skills: new Map(), byName: new Map(), byJob: new Map() },
    zones,
  } as unknown as ResourceIndex;
}

/**
 * Full 3-server byte chain with REAL handlers + REAL IpcBus + a SHARED in-memory
 * SQLite (so the account/char login + cluster read is the same row world loads
 * on JOIN). No layer is mocked between CERTIFY and the JOIN snapshot except the
 * TCP sockets (mocked) and Redis (FakeRedis). Proves the Phase 1.F publisher
 * wiring actually relays the handoff cluster->world.
 *
 *   login CERTIFY -> login:success (handoffToken)
 *   cluster PRE_JOIN -> ClusterHandoffPublisher -> IpcBus (HMAC-signed)
 *   world ClusterListener -> JoinHandler -> JOIN/ADD_OBJ snapshot
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

const SECRET = 'bytechain-secret';
const PASSWORD = 'secret';
const USERNAME = 'chainuser';
const CHAR_NAME = 'Hero';
const VALID_MD5 = createHash('md5').update('kikugalanet' + PASSWORD).digest('hex');

function mockSocket() {
  const written: Buffer[] = [];
  const sink = new PacketBuffer();
  let destroyed = false;
  return {
    remoteAddress: '127.0.0.1',
    session: { state: SessionState.CONNECTED },
    write: (b: Buffer) => { sink.push(b); for (const p of sink.drain()) written.push(p); return true; },
    destroy: () => { destroyed = true; },
    _written: () => written,
    _destroyed: () => destroyed,
  };
}

function certifyPacket(): Buffer {
  const w = new PacketWriter();
  w.writeString('20100412');                // protocolVersion
  w.writeString(USERNAME);                  // account
  w.writeBytes(encryptV15Password(VALID_MD5)); // 672-byte rijndael blob
  return w.build();
}

function preJoinPacket(charId: number): Buffer {
  const w = new PacketWriter();
  w.writeString(USERNAME);
  w.writeDword(charId);
  w.writeString(CHAR_NAME);
  w.writeLong(0);                  // bankPW
  return w.build();
}

function joinPacket(charId: number): Buffer {
  const w = new PacketWriter();
  w.writeDword(1);                 // dwWorldId
  w.writeDword(charId);
  w.writeDword(0xdeadbeef);        // dwAuthKey
  w.writeDword(0);                 // idParty
  w.writeDword(0);                 // idGuild
  w.writeDword(0);                 // idWar
  w.writeDword(0);                 // uChannel
  w.writeByte(0);                  // nSlot
  w.writeString(CHAR_NAME);        // name
  w.writeString(USERNAME);
  w.writeString(PASSWORD);
  return w.build();
}

describe('E2E byte chain: login CERTIFY -> cluster PRE_JOIN -> world JOIN snapshot', () => {
  let db: ReturnType<typeof createDb>;
  let loginSocket: ReturnType<typeof mockSocket>;
  let clusterSocket: ReturnType<typeof mockSocket>;
  let worldSocket: ReturnType<typeof mockSocket>;
  let worldPlayers: PlayerManager;
  let handoffToken: string | undefined;
  let accountId: number;
  let charId: number;

  before(async () => {
    // --- Shared in-memory DB + migrations + seed ---------------------------
    db = createDb({ client: 'better-sqlite3', connection: ':memory:' });
    await up(db);
    await upGold(db);
    const accountRepo = new AccountRepository(db);
    const charRepo = new CharacterRepository(db);
    const passwordHash = await hashPassword(VALID_MD5);
    accountId = await accountRepo.create({
      username: USERNAME, password_hash: passwordHash, email: 'c@e.com',
      banned: false, banned_until: null,
    } as any);
    charId = await charRepo.create({
      account_id: accountId, name: CHAR_NAME, slot: 0, class: 1, gender: 0,
      hair_style: 2, hair_color: 0x112233, face_style: 3, skin_color: 1, level: 15,
      exp: 0n, hp: 100, mp: 50, max_hp: 100, max_mp: 50,
      strength: 16, stamina: 15, dexterity: 14, intelligence: 13,
      x: 1.5, y: 2.5, z: 3.5, world_id: 'W1', zone_id: 1,
    });

    // --- Shared cache + bus ------------------------------------------------
    const cache = new MemoryCache();
    const redis = new FakeRedis();
    const clusterBus = new IpcBus(redis, SECRET, 'cluster-1');
    const worldBus = new IpcBus(redis, SECRET, 'world-1');

    // --- Login leg: real AuthHandler --------------------------------------
    const eventBus = createEventBus<{ 'login:success': [{ accountId: number; socket: unknown; handoffToken: string }] }>();
    eventBus.on('login:success', (d) => { handoffToken = d.handoffToken; });
    const authService = new AuthService(cache, accountRepo);
    const tokenService = new TokenService(cache, SECRET);
    const authHandler = new AuthHandler(authService, tokenService, eventBus);

    loginSocket = mockSocket();
    await authHandler.handleCertify(loginSocket as never, new PacketReader(certifyPacket()));

    // --- Cluster leg: real CharHandler + real publisher on the bus --------
    const publisher = new ClusterHandoffPublisher();
    publisher.setBus(clusterBus);
    const charSelect = new CharSelectService({
      accountRepo, charRepo,
      tokenService: new WorldHandoffTokenService(cache, SECRET),
      handoffPublisher: publisher,
      worldId: 'W1',
    });
    const charList = new CharListService(accountRepo, charRepo);
    const charCreate = new CharCreateService(accountRepo, charRepo, {
      maxPerAccount: 3, startMap: 'W1', startX: 1, startY: 2, startZ: 3, startLevel: 1,
    });
    const charHandler = new CharHandler(
      charList, charCreate, charSelect, new PlayerListSerializer(),
      new AccountConnectionManager(),
      { getCacheAddr: () => '127.0.0.1' },
    );

    // --- World leg: real ClusterListener + JoinHandler --------------------
    worldPlayers = new PlayerManager();
    const zones = new ZoneManager();
    const listener = new ClusterListener({ bus: worldBus });
    const joinService = new JoinService({
      charRepo, playerManager: worldPlayers, zoneManager: zones, handoffSource: listener,
    });
    const joinHandler = new JoinHandler(
      joinService,
      new PlayerSnapshotSerializer(),
    );
    await listener.start();

    clusterSocket = mockSocket();
    await charHandler.handlePreJoin(clusterSocket as never, new PacketReader(preJoinPacket(charId)));

    // Bus callback is async -- let it stash the handoff before JOIN.
    await new Promise((r) => setTimeout(r, 10));

    worldSocket = mockSocket();
    await joinHandler.handleJoin(worldSocket as never, new PacketReader(joinPacket(charId)));
  });

  after(async () => {
    await down(db);
    await db.destroy();
  });

  it('login CERTIFY authenticates against the shared DB and emits a handoff token', () => {
    assert.equal(accountId > 0, true);
    assert.ok(handoffToken, 'login:success must fire with a handoffToken');
  });

  it('cluster PRE_JOIN replies with the PRE_JOIN opcode', () => {
    assert.ok(clusterSocket._written().length >= 1, 'PRE_JOIN must write a reply');
    assert.equal(clusterSocket._written()[0]!.readUInt32LE(0), PACKETTYPE.PRE_JOIN);
  });

  it('world writes the 3354-byte JOIN/ADD_OBJ snapshot for the seeded char', () => {
    const snap = worldSocket._written()[0]!;
    assert.equal(snap.readUInt32LE(0), PACKETTYPE.JOIN);
    assert.equal(snap.readUInt32LE(4), charId); // objidPlayer
    assert.equal(snap.length, 3354);            // WORLD_READINFO + "Hero" blob (3350 base + 4)
  });

  it('player is live in the world after JOIN', () => {
    assert.ok(worldPlayers.get(charId));
  });
});

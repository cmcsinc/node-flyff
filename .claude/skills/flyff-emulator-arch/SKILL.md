---
name: flyff-emulator-arch
description: >
  Architecture, design patterns, and best practices for building a complete Flyff MMORPG server
  emulator in TypeScript/Node.js. Use this skill when the user asks about server structure, how to
  organize the Login Server / Cluster Server / World Server, database schema design for Flyff,
  zone/region management, NPC AI loops, spawn management, game object lifecycle, session management,
  or how to architect any part of the Flyff emulator backend. Also trigger when the user asks about
  Flyff resource file loading (defineItem, defineMover, propItem, propMover, world.wld, region files),
  inter-server communication, or performance patterns for the world tick loop.
---

# Flyff Emulator Architecture — TypeScript / Node.js

## Server Topology

```
                  ┌─────────────┐
 Client ────────► │ Login Server│  Auth + server list (:23000)
                  └──────┬──────┘
                         │ @flyff/ipc (HMAC-signed pub/sub + mTLS TCP)
                  ┌──────▼──────┐
 Client ────────► │Cluster Server│  Character select/create (:38100)
                  └──────┬──────┘
                         │ @flyff/ipc
                  ┌──────▼──────┐
 Client ────────► │ World Server │  Actual gameplay (:38180)
                  └─────────────┘
```

Each server is a separate Node.js process. IPC via `@flyff/ipc` (see `flyff-ipc-framework`).

---

## Project Structure

```
packages/
  core/           ← @flyff/core: PacketReader/Writer, LSFRCipher, constants, cache, config
  ipc/            ← @flyff/ipc: IpcBus, IpcServer, IpcClient, signing, schemas
  login-server/   ← auth, server list (:23000)
  cluster-server/ ← character management (:38100)
  world-server/   ← gameplay, zones, AI (:38180)
  database/       ← @flyff/database: Knex multi-DB (SQLite3/PG/MySQL)
resources/        ← @flyff/resources: resource file loaders
tools/            ← packet-sniffer, resource-inspector
```

---

## Package.json Workspace Root

```json
{
  "name": "flyff-emulator",
  "private": true,
  "workspaces": ["packages/*", "resources", "tools/*"],
  "scripts": {
    "build": "pnpm -r build",
    "test":  "pnpm -r test",
    "lint":  "pnpm -r lint"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "tsx": "^4.7.0"
  }
}
```

---

## Login Server

**Responsibilities**: Authenticate accounts, send server list, issue one-time tokens.

```ts
// packages/login-server/src/index.ts
import net from 'node:net';
import { PacketBuffer } from '@flyff/core/net/index.js';
import { config } from '@flyff/core/config.js';
import { logger } from '@flyff/core/logger.js';
import { createCache } from '@flyff/core/cache/createCache.js';
import { dispatch } from './dispatch.js';

const cache = await createCache();

const server = net.createServer(socket => {
  const pktBuf  = new PacketBuffer();
  socket.session = { state: SessionState.CONNECTED, accountId: null };

  socket.on('data', (chunk: Buffer) => {
    pktBuf.push(chunk);
    for (const pkt of pktBuf.drain()) void dispatch(socket, pkt);
  });

  socket.on('close', () => { /* cleanup session */ });
  socket.on('error', (err: Error) => {
    logger.warn({ err }, 'Login socket error');
    socket.destroy();
  });
});

server.listen(config.LOGIN_PORT, () => logger.info({ port: config.LOGIN_PORT }, 'Login server up'));
```

### Login Flow

1. Receive `SNSP_LOGIN_CERTIFY` → verify account in DB (argon2id hash check)
2. Send `SNSP_SERVER_LIST` with available worlds (from cache heartbeats)
3. Client selects a world → `SNSP_LOGIN_WORLD`
4. Issue UUID token, cache it (TTL 30s), send token + cluster addr to client

---

## Cluster Server

**Responsibilities**: Character CRUD, world entry handoff.

```ts
// Character list response
export async function sendCharList(socket: FlyffSocket): Promise<void> {
  const chars = await characterRepo.findByAccountId(socket.session.accountId);
  const w = new PacketWriter(SNSP_CHAR_LIST);
  w.writeByte(chars.length);
  for (const c of chars) {
    w.writeDword(c.id);
    w.writeString(c.name);
    w.writeByte(c.job);
    w.writeByte(c.level);
    w.writeDword(Number(c.gold));
    // … equipment slots
  }
  socket.write(w.build());
}
```

### Character Select → World Handoff

1. Client sends `SNSP_CHAR_SELECT`
2. Cluster publishes signed `CS_PLAYER_ENTER` to IpcBus
3. Token stored in cache (TTL 30s)
4. Client receives world IP:port + UUID token
5. World validates token on connect (see `flyff-interserver-ipc`)

---

## World Server

### Core Components

```
WorldServer
├── ZoneManager       ← loads .wld / terrain, manages zone instances
├── ObjectManager     ← all live CObj entities, ObjID registry
├── PlayerManager     ← connected CPlayer sessions
├── SpawnManager      ← NPC/monster respawn timers
├── AIScheduler       ← per-entity AI tick queue
└── GameLoop          ← master 50ms tick driving all subsystems
```

### Game Loop

```ts
// world-server/src/gameLoop.ts
import { PlayerManager }  from './managers/player.manager.js';
import { SpawnManager }   from './managers/spawn.manager.js';
import { AIScheduler }    from './systems/ai.system.js';

const TICK_MS = 50;
let last = process.hrtime.bigint();

function tick(): void {
  const now = process.hrtime.bigint();
  const dt  = Number(now - last) / 1e6; // milliseconds
  last = now;

  playerManager.tick(dt);
  spawnManager.tick(dt);
  aiScheduler.tick(dt);
}

setInterval(tick, TICK_MS);
```

### Zone / Region Management

```ts
// managers/zone.manager.ts
import type { CPlayer } from '../entities/player.js';
import type { IPosition } from '@flyff/core/types/entities.js';

class Zone {
  readonly objects = new Map<number, CMover>();
  readonly players = new Map<number, CPlayer>();
  readonly spawns: SpawnPoint[] = [];

  constructor(readonly id: number) {}

  broadcast(packet: Buffer, exclude?: CPlayer): void {
    for (const player of this.players.values()) {
      if (player !== exclude) player.socket.write(packet);
    }
  }

  broadcastAround(pos: IPosition, radius: number, packet: Buffer, exclude?: CPlayer): void {
    const r2 = radius * radius;
    for (const player of this.players.values()) {
      if (player === exclude) continue;
      const dx = pos.x - player.m_vPos.x;
      const dy = pos.y - player.m_vPos.y;
      const dz = pos.z - player.m_vPos.z;
      if (dx*dx + dy*dy + dz*dz <= r2) player.socket.write(packet);
    }
  }

  addPlayer(player: CPlayer): void    { this.players.set(player.m_dwCharId, player); }
  removePlayer(charId: number): void  { this.players.delete(charId); }
}
```

---

## Resource File Loading

```ts
// resources/src/loader.ts
import { parsePropFile } from './parsers/propFile.parser.js';
import type { ItemProp, MoverProp } from './types.js';

export const propItem  = new Map<number, ItemProp>();
export const propMover = new Map<number, MoverProp>();
export const propSkill = new Map<number, SkillProp>();

export async function loadResources(resPath: string): Promise<void> {
  for (const [id, prop] of await parsePropFile<ItemProp>(`${resPath}/propItem.txt`))
    propItem.set(id, prop);
  for (const [id, prop] of await parsePropFile<MoverProp>(`${resPath}/propMover.txt`))
    propMover.set(id, prop);
}
```

See `references/resource-formats.md` for propItem/propMover column layouts.

---

## NPC / Monster AI Pattern

```ts
// entities/npc.ts
type AIState = 'idle' | 'patrol' | 'chase' | 'attack' | 'dead';

class AIController {
  state: AIState = 'idle';
  target: CPlayer | null = null;
  #timer = 0;

  constructor(private readonly mover: CCtrl) {}

  tick(dt: number): void {
    this.#timer += dt;
    switch (this.state) {
      case 'idle':   this.#tickIdle(dt);   break;
      case 'patrol': this.#tickPatrol(dt); break;
      case 'chase':  this.#tickChase(dt);  break;
      case 'attack': this.#tickAttack(dt); break;
    }
  }

  #tickIdle(_dt: number): void {
    if (this.#timer < 3_000) return;
    this.target = this.mover.zone?.findPlayerInRange(
      this.mover.m_vPos, this.mover.m_nAggroRange
    ) ?? null;
    if (this.target) this.state = 'chase';
    this.#timer = 0;
  }
}
```

---

## Session State Machine

```ts
// packages/core/src/constants/sessionState.ts
export const SessionState = Object.freeze({
  CONNECTED:      0,
  AUTHENTICATING: 1,
  IN_LOBBY:       2,
  IN_WORLD:       3,
  DISCONNECTED:   4,
} as const);
export type SessionState = typeof SessionState[keyof typeof SessionState];
```

Guard handlers by state:
```ts
export async function handleLoginCertify(socket: FlyffSocket, reader: PacketReader): Promise<void> {
  if (socket.session.state !== SessionState.CONNECTED) return;
  // process login
}
```

---

## Performance Tips

- **Object pooling** — reuse `PacketWriter` and temporary vector objects
- **Zone-based broadcasting** — never iterate all players, only zone-local ones
- **Dirty flags** — only persist character data on meaningful change, not every tick
- **Hybrid WAL Persistence** — append critical changes to embedded SQLite journal, flush to Knex DB every 30s
- **Worker threads** for CPU-heavy tasks (pathfinding, collision checks)
- Keep main event loop tick < 10ms; heavy work goes to Worker Threads
- Use `process.hrtime.bigint()` for precise tick delta (not `Date.now()`)

---

## Reference Files

- `references/resource-formats.md` — propItem.txt, propMover.txt column layout

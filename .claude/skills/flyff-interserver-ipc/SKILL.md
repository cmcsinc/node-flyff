---
name: flyff-interserver-ipc
description: >
  Inter-server communication (IPC) for the Flyff TypeScript emulator: Login ↔ Cluster ↔
  World server messaging, HMAC-signed Redis pub/sub, internal TLS TCP protocol, player handoff
  between servers, GM commands across servers, server status broadcasting, and typed IPC message
  schemas. Use this skill when implementing how servers talk to each other, how to hand a player
  from cluster to world server, how to broadcast GM messages, or how to implement the internal
  admin channel. Trigger on: "inter-server", "IPC", "server communication", "handoff",
  "cluster to world", "login to cluster", "Redis pub/sub", "internal socket", "server list",
  "cross-server", "GM broadcast", "server status", "server channel", "HMAC", "IpcBus",
  "IpcServer", "IpcClient", "signed message".
---

# Flyff Emulator — Inter-Server IPC

## Overview

All inter-server communication goes through **`@flyff/ipc`** — a secure IPC framework built on:

1. **Redis pub/sub** — async events (HMAC-SHA256 signed)
2. **Internal TLS TCP** — sync request/response with mutual cert auth

Every message must be signed with `IPC_SECRET` (env var, min 32 chars). Unsigned or tampered messages are rejected immediately.

---

## Channels

```ts
// packages/core/src/ipc/channels.ts
export const IPC = Object.freeze({
  // Login → Cluster
  LS_SERVER_LIST_UPDATE: 'ls:serverList:update',

  // Cluster → World
  CS_PLAYER_ENTER: 'cs:player:enter',   // player entering world
  CS_PLAYER_ABORT: 'cs:player:abort',   // player disconnected before entering

  // World → Cluster
  WS_PLAYER_ENTERED: 'ws:player:entered', // confirm player in world
  WS_PLAYER_LEFT:    'ws:player:left',    // player logged out of world

  // World → All (broadcast)
  WS_GM_ANNOUNCE: 'ws:gm:announce',
  WS_SHUTDOWN:    'ws:shutdown',

  // All → All (monitoring)
  HEARTBEAT:     'heartbeat',
  SERVER_STATUS: 'server:status',
} as const);

export type IpcChannel = typeof IPC[keyof typeof IPC];
```

---

## IPC Message Envelope

Every message is wrapped in a signed envelope:

```ts
// packages/ipc/src/types.ts
export interface IpcEnvelope<T = unknown> {
  ts:      number;   // Unix ms — reject if > 30s old
  from:    string;   // SERVER_ID of sender
  sig:     string;   // HMAC-SHA256 hex signature
  payload: T;
}
```

---

## Player Handoff: Cluster → World

### Step 1 — Cluster issues handoff

```ts
// cluster-server/src/handlers/charSelect.handler.ts
import { IpcBus } from '@flyff/ipc';
import { IPC } from '@flyff/core/ipc/channels.js';
import { CacheKey } from '@flyff/core/cache/keys.js';
import type { PlayerEnterPayload } from '@flyff/ipc/schemas/playerEnter.schema.js';

export async function handleCharSelect(socket: FlyffSocket, reader: PacketReader): Promise<void> {
  const charSlot = reader.readByte();
  PacketValidate.slot(charSlot);

  const char = await characterRepo.findBySlot(socket.session.accountId, charSlot);
  if (!char) throw new GameError('Character not found', 'CHAR_NOT_FOUND');

  // One-time UUID token
  const token = crypto.randomUUID();

  // Store token in cache (consumed by world on connect)
  const payload: PlayerEnterPayload = {
    token,
    accountId: socket.session.accountId,
    charId:    char.id,
    zoneId:    char.zone_id,
  };
  await cache.set(CacheKey.token(token), JSON.stringify(payload), 30);

  // Notify world via signed IPC
  await ipcBus.publish<PlayerEnterPayload>(IPC.CS_PLAYER_ENTER, payload);

  // Send world address + token to client
  const w = new PacketWriter(SNSP_CHAR_SELECT_RESP);
  w.writeByte(1);
  w.writeString(config.WORLD_SERVER_IP ?? '127.0.0.1');
  w.writeWord(config.WORLD_PORT);
  w.writeString(token);
  socket.write(w.build());
}
```

### Step 2 — World redeems token

```ts
// world-server/src/handlers/welcome.handler.ts
import type { PlayerEnterPayload } from '@flyff/ipc/schemas/playerEnter.schema.js';
import { CacheKey } from '@flyff/core/cache/keys.js';

export async function handleWorldEnter(socket: FlyffSocket, reader: PacketReader): Promise<void> {
  const token = reader.readString();

  // Redeem from cache (single-use)
  const raw = await cache.get(CacheKey.token(token));
  if (!raw) {
    sendError(socket, 'Invalid session');
    socket.destroy();
    return;
  }
  await cache.del(CacheKey.token(token));

  const handoff = JSON.parse(raw) as PlayerEnterPayload;

  // Load + register player
  const player = await playerLoader.load(handoff.charId);
  player.socket = socket;
  socket.session.player  = player;
  socket.session.state   = SessionState.IN_WORLD;

  playerManager.register(player);
  zoneManager.getZone(handoff.zoneId).addPlayer(player);

  await sendWorldEnterPackets(socket, player);

  // Confirm to cluster
  await ipcBus.publish(IPC.WS_PLAYER_ENTERED, {
    charId:    player.m_dwCharId,
    accountId: handoff.accountId,
  });
}
```

---

## Server List Heartbeat

```ts
// cluster-server/src/ipc/heartbeat.ts
import { CacheKey } from '@flyff/core/cache/keys.js';

export function startHeartbeat(cache: ICacheAdapter): void {
  const publish = async (): Promise<void> => {
    await cache.set(CacheKey.cluster(config.SERVER_ID), JSON.stringify({
      id:         config.SERVER_ID,
      name:       config.SERVER_NAME,
      ip:         config.PUBLIC_IP,
      port:       config.CLUSTER_PORT,
      players:    playerManager.count,
      maxPlayers: config.MAX_PLAYERS,
      status:     'online',
    }), 10); // 10s TTL — must renew before expiry
  };

  void publish();
  setInterval(() => void publish(), 5_000);
}
```

Login server reads server list:
```ts
// login-server/src/services/serverList.service.ts
export async function getServerList(cache: ICacheAdapter): Promise<ServerEntry[]> {
  // Use scan pattern via Redis or pre-published list key
  const raw = await cache.get(CacheKey.serverList());
  return raw ? (JSON.parse(raw) as ServerEntry[]) : [];
}
```

---

## GM Commands Across Servers

```ts
// Announce from any server to all players on all worlds
await ipcBus.publish(IPC.WS_GM_ANNOUNCE, { message, senderId: gm.m_dwCharId });

// Each world server receives and broadcasts
ipcBus.subscribe(IPC.WS_GM_ANNOUNCE, ({ message }: { message: string }) => {
  const pkt = buildAnnouncementPacket(message);
  for (const player of playerManager.all()) player.socket.write(pkt);
});
```

---

## Graceful Shutdown

```ts
await ipcBus.publish(IPC.WS_SHUTDOWN, {
  delayMs: 60_000,
  message: 'Server shutting down in 60s',
});
```

---

## Security Rules

- All messages MUST pass `verifyIpcMessage()` from `@flyff/ipc/signing`
- Reject messages with `ts` older than 30 seconds (replay protection)
- Reject messages with unknown `from` values
- `IPC_SECRET` must be at minimum 32 characters — enforced by Zod config schema
- Internal TCP uses TLS with self-signed certs — see `flyff-ipc-framework` skill

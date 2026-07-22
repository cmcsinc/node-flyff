/**
 * Cluster client-facing TCP server.
 *
 * Binds the four character packets to `CharHandler`: `GETPLAYERLIST`,
 * `CREATE_PLAYER`, `DELETE_PLAYER`, `PRE_JOIN`. `index.ts` calls
 * `server.listen(config.server.port)`.
 *
 * @module clientServer
 */

import type { Server } from 'node:net';
import { createClientServer, type PacketDispatcher, type DispatcherLogger } from '@flyff/core/net';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { sendPacket } from '@flyff/core/net/dispatcher.js';
import type { CharHandler } from './handlers/char.handler.js';

/**
 * FILETIME epoch bias -- 100-ns ticks between 1601-01-01 (FILETIME/Windows
 * epoch) and 1970-01-01 (Unix epoch). `g_TickCount.GetTickCount()` is a
 * FILETIME-derived 100-ns value (`tickcount.h:50`), so the reply must be in
 * the same units for the client's clock re-seed to land correctly.
 */
const FILETIME_EPOCH_BIAS = 116444736000000000n;

export interface ClusterClientServerDeps {
  charHandler: CharHandler;
  logger?: DispatcherLogger;
}

export function buildClusterClientServer(deps: ClusterClientServerDeps): {
  server: Server;
  dispatcher: PacketDispatcher;
} {
  const dd: { logger?: DispatcherLogger; crc: true; leadsWithDpid: true } = { crc: true, leadsWithDpid: true };
  if (deps.logger !== undefined) dd.logger = deps.logger;
  const { server, dispatcher } = createClientServer(dd);
  const h = deps.charHandler;
  // PING (0x14) -- echo the client's dwPingTime back (`DPLoginSrvr.cpp:264-265`).
  // The client pings after the welcome hello and waits for this echo.
  dispatcher.register(PACKETTYPE.PING, (s, r) => {
    const dwPingTime = r.readDword();
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.PING);
    w.writeDword(dwPingTime);
    sendPacket(s, w.build());
  });
  // QUERYTICKCOUNT (0x0b) -- server-clock sync. The client fires this once on
  // every cluster connect (`WndTitle.cpp:1050`, before GETPLAYERLIST), sending
  // its `timeGetTime()` tick. Server echoes it back alongside the FILETIME-style
  // `g_TickCount.GetTickCount()` so the client can re-seed its clock with a
  // half-RTT bias (`DPLoginSrvr.cpp:270-278`, `Neuz/DPLoginClient.cpp:104-116`).
  dispatcher.register(PACKETTYPE.QUERYTICKCOUNT, (s, r) => {
    const dwTime = r.readDword();
    const w = new PacketWriter();
    w.writeDword(PACKETTYPE.QUERYTICKCOUNT);
    w.writeDword(dwTime);
    w.writeQword(BigInt(Date.now()) * 10000n + FILETIME_EPOCH_BIAS);
    sendPacket(s, w.build());
  });
  dispatcher.register(PACKETTYPE.GETPLAYERLIST, (s, r) => h.handleGetPlayerList(s, r));
  dispatcher.register(PACKETTYPE.CREATE_PLAYER, (s, r) => h.handleCreatePlayer(s, r));
  dispatcher.register(PACKETTYPE.DELETE_PLAYER, (s, r) => h.handleDeletePlayer(s, r));
  dispatcher.register(PACKETTYPE.PRE_JOIN, (s, r) => h.handlePreJoin(s, r));
  return { server, dispatcher };
}

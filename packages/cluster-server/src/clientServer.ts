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
import type { CharHandler } from './handlers/char.handler.js';

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
  dispatcher.register(PACKETTYPE.GETPLAYERLIST, (s, r) => h.handleGetPlayerList(s, r));
  dispatcher.register(PACKETTYPE.CREATE_PLAYER, (s, r) => h.handleCreatePlayer(s, r));
  dispatcher.register(PACKETTYPE.DELETE_PLAYER, (s, r) => h.handleDeletePlayer(s, r));
  dispatcher.register(PACKETTYPE.PRE_JOIN, (s, r) => h.handlePreJoin(s, r));
  return { server, dispatcher };
}

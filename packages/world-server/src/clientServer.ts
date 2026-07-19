/**
 * World client-facing TCP server.
 *
 * Binds the single enter-world packet (`JOIN`) to `JoinHandler`, which writes
 * the JOIN/ADD_OBJ self-spawn snapshot on success. `index.ts` calls
 * `server.listen(config.server.port)`.
 *
 * @module clientServer
 */

import type { Server } from 'node:net';
import { createClientServer, type PacketDispatcher, type DispatcherLogger } from '@flyff/core/net';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import type { JoinHandler } from './handlers/join.handler.js';

export interface WorldClientServerDeps {
  joinHandler: JoinHandler;
  logger?: DispatcherLogger;
}

export function buildWorldClientServer(deps: WorldClientServerDeps): {
  server: Server;
  dispatcher: PacketDispatcher;
} {
  const dd: { logger?: DispatcherLogger; crc: true; leadsWithDpid: true } = { crc: true, leadsWithDpid: true };
  if (deps.logger !== undefined) dd.logger = deps.logger;
  const { server, dispatcher } = createClientServer(dd);
  dispatcher.register(PACKETTYPE.JOIN, (s, r) => deps.joinHandler.handleJoin(s, r));
  return { server, dispatcher };
}

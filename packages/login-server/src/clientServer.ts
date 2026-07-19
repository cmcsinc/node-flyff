/**
 * Login client-facing TCP server.
 *
 * Binds the only client→login packet (`CERTIFY`) to `AuthHandler`. SRVR_LIST is
 * sent reactively: `AuthHandler` emits `login:success`, which `compose.ts`
 * wires to `ServerListHandler.sendServerList` (rule 02 — handler emits, service
 * replies via the bus). `index.ts` calls `server.listen(config.server.port)`.
 *
 * @module clientServer
 */

import type { Server } from 'node:net';
import { createClientServer, type PacketDispatcher, type DispatcherLogger } from '@flyff/core/net';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import type { AuthHandler } from './handlers/auth.handler.js';

export interface LoginClientServerDeps {
  authHandler: AuthHandler;
  logger?: DispatcherLogger;
}

export function buildLoginClientServer(deps: LoginClientServerDeps): {
  server: Server;
  dispatcher: PacketDispatcher;
} {
  const dd: { logger?: DispatcherLogger; crc?: boolean } = { crc: true };
  if (deps.logger !== undefined) dd.logger = deps.logger;
  const { server, dispatcher } = createClientServer(dd);
  // PING (0x14) — on the certifier the client sends a keepalive ping with a
  // short/empty body; the C++ certifier does NOT reply (OnPing just forwards
  // internally, DPCertifier.cpp:306). Absorb it here so the dispatcher doesn't
  // log "Unknown opcode". (The LoginServer/cluster DOES echo dwPingTime — see
  // cluster-server/src/clientServer.ts.)
  dispatcher.register(PACKETTYPE.PING, () => {});
  dispatcher.register(PACKETTYPE.CERTIFY, (s, r) => deps.authHandler.handleCertify(s, r));
  return { server, dispatcher };
}

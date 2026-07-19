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
  dispatcher.register(PACKETTYPE.CERTIFY, (s, r) => deps.authHandler.handleCertify(s, r));
  return { server, dispatcher };
}

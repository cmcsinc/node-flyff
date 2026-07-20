/**
 * LEAVE handler — `PACKETTYPE_LEAVE` (0x0000ff01).
 *
 * C++ routes this to `CDPSrvr::OnRemoveUser` (DPSrvr.cpp:123) which tears down
 * the connection. No packet body. The socket is destroyed; cleanup of player
 * state is done by the disconnect handler in {@link clientServer} (rule 05 —
 * remove from PlayerManager + ZoneManager on disconnect).
 *
 * @module handlers/leave.handler
 */

import type { ClientSocket } from '@flyff/core/net/dispatcher.js';
import { createLogger } from '@flyff/core/logger.js';

const logger = createLogger({ module: 'leave-handler' });

export class LeaveHandler {
  handleLeave(socket: ClientSocket): void {
    const charId = socket.session?.charId ?? -1;
    logger.info({ charId }, 'LEAVE — disconnecting');
    socket.destroy();
  }
}

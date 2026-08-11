/**
 * LEAVE handler -- `PACKETTYPE_LEAVE` (0x0000ff01).
 *
 * C++ routes this to `CDPSrvr::OnRemoveUser` (DPSrvr.cpp:123) which tears down
 * the connection. No packet body. The socket is destroyed; cleanup of player
 * state is done by the disconnect handler in {@link clientServer} (rule 05 --
 * remove from PlayerManager + ZoneManager on disconnect).
 *
 * @module handlers/leave.handler
 */

import type { Socket } from 'node:net';
import type { ClientSession } from '@flyff/core/net/dispatcher';
import { createLogger } from '@flyff/core/logger';

const logger = createLogger({ module: 'leave-handler' });

/**
 * LEAVE can arrive on a socket the dispatcher has already torn down, so
 * `session` is genuinely absent at runtime even though `ClientSocket` declares
 * it required. The param is widened to make that optional rather than assert it
 * away. Covered by leave.handler.test.ts "does not throw when session is
 * missing".
 */
type LeavingSocket = Socket & { session?: ClientSession };

export class LeaveHandler {
  handleLeave(socket: LeavingSocket): void {
    const charId = socket.session?.charId ?? -1;
    logger.info({ charId }, 'LEAVE -- disconnecting');
    socket.destroy();
  }
}

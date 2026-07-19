/**
 * JOIN handler — enter-world packet (`PACKETTYPE_JOIN`, CDPSrvr::OnAddUser,
 * `WORLDSERVER/DPSrvr.cpp:612`).
 *
 * Fields read (Cache→World JOIN, `DPSrvr.cpp:616-626`):
 *   dwAuthKey:DWORD  idPlayer:DWORD  nSlot:BYTE  dpidSocket:DWORD
 *   account:String   password:String  addr:String
 *
 * `nSlot >= 3` is rejected (C++ line 628). On a valid handoff + character the
 * handler delegates to `JoinService` and writes the JOIN self-spawn snapshot
 * back to the socket. On any failure the connection is dropped (C++ destroys
 * the ghost) — no error packet on this path.
 *
 * @module handlers/join.handler
 */

import type { Socket } from 'node:net';
import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { sendPacket } from '@flyff/core/net/dispatcher.js';
import { createLogger } from '@flyff/core/logger.js';
import type { JoinService } from '../services/join.service.js';
import type { PlayerSnapshotSerializer } from '../net/snapshot/playerSnapshot.serializer.js';

const logger = createLogger({ module: 'join-handler' });

export class JoinHandler {
  constructor(
    private joinService: JoinService,
    private snapshotSerializer: PlayerSnapshotSerializer,
  ) {}

  async handleJoin(socket: Socket, reader: PacketReader): Promise<void> {
    let outcome;
    try {
      const _dwAuthKey = reader.readDword();
      const idPlayer = reader.readDword();
      const nSlot = reader.readByte();
      const _dpidSocket = reader.readDword();
      const _account = reader.readString();
      const _password = reader.readString();
      const _addr = reader.readString();

      if (nSlot >= 3) {
        logger.warn({ idPlayer, nSlot }, 'JOIN rejected — slot out of range');
        socket.destroy();
        return;
      }

      outcome = await this.joinService.join(socket, idPlayer);
    } catch (error) {
      logger.error({ error }, 'JOIN parse failed');
      socket.destroy();
      return;
    }

    if (!outcome.ok) {
      logger.warn({ reason: outcome.reason }, 'JOIN rejected');
      socket.destroy();
      return;
    }

    sendPacket(socket, this.snapshotSerializer.build(outcome.player));
    logger.info({ idPlayer: outcome.player.m_idPlayer }, 'Player entered world');
  }
}

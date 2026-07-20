/**
 * JOIN handler — client enter-world packet (`PACKETTYPE_JOIN`).
 *
 * This is the **client → cache/world** JOIN sent by Neuz
 * (`Neuz/DPClient.cpp:8959` `CDPClient::SendJoin`), whose read order is fixed
 * by `CACHESERVER/Player.cpp:35` `CPlayer::Join`:
 *
 *   dwWorldId:DWORD  idPlayer:DWORD  dwAuthKey:DWORD  idParty:DWORD
 *   idGuild:DWORD    idWar:DWORD     uChannel:DWORD   nSlot:BYTE
 *   name:String      account:String  password:String  [messenger block]
 *
 * Note: `WORLDSERVER/DPSrvr.cpp:612` `OnAddUser` reads a *different*
 * (cache→world internal) layout. In v15 the CacheServer re-serializes the
 * packet before forwarding. This emulator has no separate cache layer, so the
 * world's client-facing port receives the Neuz-format packet directly.
 *
 * `nSlot >= 3` is rejected (C++ `OnAddUser` line 628). On a valid handoff +
 * character the handler delegates to `JoinService` and writes the JOIN
 * self-spawn snapshot back to the socket. On any failure the connection is
 * dropped (C++ destroys the ghost) — no error packet on this path.
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
      const _dwWorldId = reader.readDword();
      const idPlayer = reader.readDword();
      const _dwAuthKey = reader.readDword();
      const _idParty = reader.readDword();
      const _idGuild = reader.readDword();
      const _idWar = reader.readDword();
      const _uChannel = reader.readDword();
      const nSlot = reader.readByte();
      const _name = reader.readString();
      const _account = reader.readString();
      const _password = reader.readString();

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

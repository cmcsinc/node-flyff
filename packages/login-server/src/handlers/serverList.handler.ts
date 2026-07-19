import type { Socket } from 'node:net';
import { randomInt } from 'node:crypto';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { sendPacket } from '@flyff/core/net/dispatcher.js';
import type { ServerListService } from '../services/serverList.service.js';
import { createLogger } from '@flyff/core/logger.js';

const logger = createLogger({ module: 'serverlist-handler' });

/**
 * Server list handler — sends `PACKETTYPE_SRVR_LIST` (0xfd).
 *
 * Byte layout mirrors what the v15 client parses (`Neuz/DPCertified.cpp:204-270`
 * `CDPCertified::OnSvrList`, server send at `CERTIFIER/DPCertifier.cpp:154-196`):
 *
 *   [DWORD dwAuthKey][BYTE cbAccountFlag][DWORD count]
 *   per server: [DWORD parent][DWORD id][string name][string addr]
 *               [DWORD b18][long count][long enable][long max]
 *
 * `BOOL b18` is 4 bytes on Win32 (`_Network/Misc/Include/Misc.h:8-30`). Minimum
 * v15 mainserver build (no `__BILLING0712` / `__GPAUTH_*` / `LANG_THA`).
 *
 * `dwAuthKey` is the certifier-issued session key the client carries to the
 * `:28000` LoginServer. Slice: generated random non-zero here (the cluster path
 * currently authenticates via signed IPC handoff, not this DWORD); a full impl
 * should cache + validate it on the cluster side.
 */
export class ServerListHandler {
  constructor(private serverListService: ServerListService) {}

  async sendServerList(socket: Socket, accountId: number): Promise<void> {
    try {
      const servers = this.serverListService.getServerList();
      const dwAuthKey = randomInt(1, 0x100000000); // non-zero DWORD

      const writer = new PacketWriter();
      writer.writeDword(PACKETTYPE.SRVR_LIST);
      writer.writeDword(dwAuthKey);       // dwAuthKey
      writer.writeByte(0);                // cbAccountFlag
      writer.writeDword(servers.length);  // dwSizeofServerset

      servers.forEach((server, i) => {
        writer.writeDword(0);             // dwParent (top-level)
        writer.writeDword(i + 1);         // dwID (1-indexed)
        writer.writeString(server.name);  // lpName
        writer.writeString(server.ip);    // lpAddr
        writer.writeDword(0);             // b18 (BOOL, 4 bytes)
        writer.writeDword(server.players); // lCount
        writer.writeDword(server.status === 'online' ? 1 : 0); // lEnable
        writer.writeDword(server.maxPlayers); // lMax
      });

      sendPacket(socket, writer.build());
      logger.info({ accountId, serverCount: servers.length, dwAuthKey }, 'Server list sent');
    } catch (error) {
      logger.error({ error, accountId }, 'Failed to send server list');
    }
  }
}

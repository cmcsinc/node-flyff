import type { Socket } from 'node:net';
import { SNSP } from '@flyff/core/constants/opcodes.js';
import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import type { ServerListService } from '../services/serverList.service.js';
import { createLogger } from '@flyff/core/logger.js';

const logger = createLogger({ module: 'serverlist-handler' });

/**
 * Server list handler.
 *
 * Sends the list of available cluster servers to the client.
 */
export class ServerListHandler {
  constructor(private serverListService: ServerListService) {}

  /**
   * Send server list to client.
   *
   * Packet structure:
   * - header: WORD (0x5E80)
   * - opcode: WORD (SNSP_SERVER_LIST)
   * - serverCount: BYTE
   * - For each server:
   *   - serverId: DWORD
   *   - serverName: string (DWORD-length-prefixed)
   *   - playerCount: DWORD
   *   - maxPlayers: DWORD
   *   - serverStatus: BYTE (0 = maintenance, 1 = low, 2 = medium, 3 = high)
   *
   * @param socket - Client socket
   * @param accountId - Account ID (for logging)
   */
  async sendServerList(socket: Socket, accountId: number): Promise<void> {
    try {
      const servers = this.serverListService.getServerList();

      const writer = new PacketWriter();
      writer.writeWord(0x5E80); // Header
      writer.writeWord(SNSP.SERVER_LIST);
      writer.writeByte(servers.length);

      for (let i = 0; i < servers.length; i++) {
        const server = servers[i];
        if (!server) continue;

        writer.writeDword(i + 1); // Server ID (1-indexed)
        writer.writeString(server.name);
        writer.writeDword(server.players);
        writer.writeDword(server.maxPlayers);
        // Map status string to byte: offline=0, maintenance=1, online=2
        const statusByte = server.status === 'online' ? 2 : server.status === 'maintenance' ? 1 : 0;
        writer.writeByte(statusByte);
      }

      const packet = writer.build();
      socket.write(packet);

      logger.info({ accountId, serverCount: servers.length }, 'Server list sent');
    } catch (error) {
      logger.error({ error, accountId }, 'Failed to send server list');
    }
  }

  /**
   * Send new server list packet (for future use with newer client versions).
   *
   * This is a placeholder for extended server list format if needed.
   */
  async sendNewServerList(socket: Socket, accountId: number): Promise<void> {
    // For now, use the same format
    await this.sendServerList(socket, accountId);
  }
}

import type { Socket } from 'node:net';
import { randomInt } from 'node:crypto';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { sendPacket } from '@flyff/core/net/dispatcher';
import type { ServerListService } from '../services/serverList.service';
import { createLogger } from '@flyff/core/logger';

const logger = createLogger({ module: 'serverlist-handler' });

/**
 * `NULL_ID` -- Flyff sentinel for "no id / no parent" (`NULL_ID = 0xffffffff`,
 * `_Network/Misc/Include/Misc.h:20`, `SERVER_DESC` default ctor). The client's
 * server-select dialog (`WndTitle.cpp:691`) adds a server to the list box ONLY
 * when `dwParent == NULL_ID`; sending `dwParent = 0` yields a silently empty
 * list (no crash, dialog opens, zero entries). Channel entries keep
 * `dwParent = <parent server dwID>`.
 */
const NULL_ID = 0xffffffff;

/**
 * Server list handler -- sends `PACKETTYPE_SRVR_LIST` (0xfd).
 *
 * Byte layout mirrors what the v19 client parses (`Neuz/DPCertified.cpp:204-270`
 * `CDPCertified::OnSvrList`, server send at `CERTIFIER/DPCertifier.cpp:154-196`):
 *
 *   [DWORD dwAuthKey][BYTE cbAccountFlag][DWORD count]
 *   per server: [DWORD parent][DWORD id][string name][string addr]
 *               [DWORD b18][long count][long enable][long max]
 *
 * `BOOL b18` is 4 bytes on Win32 (`_Network/Misc/Include/Misc.h:8-30`). Minimum
 * v19 mainserver build (no `__BILLING0712` / `__GPAUTH_*` / `LANG_THA`).
 *
 * `dwAuthKey` is the certifier-issued session key the client carries to the
 * `:28000` LoginServer. Slice: generated random non-zero here (the cluster path
 * currently authenticates via signed IPC handoff, not this DWORD); a full impl
 * should cache + validate it on the cluster side.
 */
export class ServerListHandler {
  constructor(private serverListService: ServerListService) {}

  sendServerList(socket: Socket, accountId: number, account: string): void {
    try {
      const servers = this.serverListService.getServerList();
      const dwAuthKey = randomInt(1, 0x100000000); // non-zero DWORD

      // Flatten the server->channel tree into the SERVER_DESC array the v19
      // client expects (WndTitle.cpp:685-747): top-level servers have
      // dwParent=NULL_ID (0xffffffff) and populate the server list box; channels
      // have dwParent=<server.dwID> and populate the channel list box. With no
      // channel children the client cannot proceed past server-select, so the
      // connect to PN_LOGINSRVR never happens.
      let nextId = 1;
      const entries: {
        parent: number; id: number; name: string; addr: string;
        count: number; enable: number; max: number;
      }[] = [];
      for (const server of servers) {
        const serverId = nextId++;
        entries.push({
          parent: NULL_ID, id: serverId, name: server.name, addr: server.ip,
          count: server.players,
          enable: server.status === 'online' ? 1 : 0,
          max: server.maxPlayers,
        });
        if (server.channels.length === 0 && server.status === 'online') {
          logger.warn(
            { server: server.name },
            'Online server has no channels -- client cannot select a channel. '
              + 'Ensure the world server is registered with the cluster.',
          );
        }
        for (const ch of server.channels) {
          entries.push({
            parent: serverId, id: nextId++, name: ch.name,
            // Channel lpAddr is cosmetic -- the client connects on the parent
            // server's addr (WndTitle.cpp:1019-1034 walks to the parent).
            addr: server.ip,
            count: ch.players,
            enable: ch.status === 'online' ? 1 : 0,
            max: ch.maxPlayers,
          });
        }
      }

      const writer = new PacketWriter();
      writer.writeDword(PACKETTYPE.SRVR_LIST);
      writer.writeDword(dwAuthKey);        // dwAuthKey
      writer.writeByte(0);                 // cbAccountFlag
      // szBak (account-name echo) -- REQUIRED by the client's __EUROPE_0514 build
      // (Neuz/VersionCommon.h:169). OnSvrList reads this string right after
      // cbAccountFlag and hard-exits on mismatch (DPCertified.cpp:224-231).
      // Without it the client reads our count DWORD as the string length,
      // then 3 bytes of dwParent as the account, lstrcmp != "test" -> exit(0).
      // Confirmed empirically: removing this line brings the crash back.
      writer.writeString(account);         // szBak
      writer.writeDword(entries.length);   // dwSizeofServerset (servers + channels)

      for (const e of entries) {
        writer.writeDword(e.parent);       // dwParent
        writer.writeDword(e.id);           // dwID
        writer.writeString(e.name);        // lpName
        writer.writeString(e.addr);        // lpAddr
        writer.writeDword(0);              // b18 (BOOL, 4 bytes)
        writer.writeDword(e.count);        // lCount
        writer.writeDword(e.enable);       // lEnable
        writer.writeDword(e.max);          // lMax
      }

      const payload = writer.build();
      sendPacket(socket, payload);
      logger.info(
        {
          accountId,
          serverCount: servers.length,
          entries: entries.length,
          dwAuthKey,
          // Diagnostic: exact wire bytes (after the 0x5E frame wrapper) so the
          // client's OnSvrrList parse can be traced field-by-field.
          hex: payload.toString('hex'),
          tree: entries.map(e => ({ p: e.parent, id: e.id, name: e.name, addr: e.addr, on: e.enable })),
        },
        'Server list sent',
      );
    } catch (error) {
      logger.error({ error, accountId }, 'Failed to send server list');
    }
  }
}

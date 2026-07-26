/**
 * Character select/create/delete/enter-world handler.
 *
 * Handles the four client-facing character packets on the cluster server.
 * Field layouts follow the C++ client send paths
 * (`game/source/Neuz/DPLoginClient.cpp:118-202`). The handler only parses +
 * validates + delegates to one service per packet (rule 02). On create/delete
 * success the C++ server re-sends a fresh PLAYER_LIST; errors go via
 * PACKETTYPE_ERROR (0xfe) with the error code as a DWORD payload.
 *
 * @module handlers/char.handler
 */

import type { Socket } from 'node:net';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { sendPacket } from '@flyff/core/net/dispatcher';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { createLogger } from '@flyff/core/logger';
import type { CharListService } from '../services/charList.service';
import type { CharCreateService } from '../services/charCreate.service';
import type { CharSelectService } from '../services/charSelect.service';
import type { PlayerListSerializer } from '../net/playerList.serializer';
import type { AccountConnectionManager } from '../managers/accountConnection.manager';

const logger = createLogger({ module: 'char-handler' });

/** Resolves the public address the client should dial for gameplay (:5400). */
export interface CacheAddrSource {
  /** World/cache server public IPv4, or null when no world is registered. */
  getCacheAddr(): string | null;
}

export class CharHandler {
  constructor(
    private charListService: CharListService,
    private charCreateService: CharCreateService,
    private charSelectService: CharSelectService,
    private playerListSerializer: PlayerListSerializer,
    private accountConnections: AccountConnectionManager,
    private cacheAddrSource: CacheAddrSource,
  ) {}

  /** PACKETTYPE_GETPLAYERLIST (0xf6) -> replies PLAYER_LIST. */
  async handleGetPlayerList(socket: Socket, reader: PacketReader): Promise<void> {
    try {
      const _version = reader.readString();
      const authKey = reader.readDword();
      const account = reader.readString();
      const _password = reader.readString();
      const _dwId = reader.readDword();

      // C++ destroys the connection when dwAuthKey == 0 (DPLoginSrvr.cpp:145).
      if (authKey === 0) {
        logger.warn({ account }, 'GETPLAYERLIST with zero auth key -- dropping');
        return;
      }

      // Mirror C++ g_UserMng.AddUser: one live connection per account. A stale
      // socket (client "went back" without closing) is kicked so re-login works
      // without restarting the client (DPLoginSrvr.cpp:164-181).
      const kicked = this.accountConnections.bind(account, socket);
      if (kicked) logger.info({ account }, 'Kicked stale account connection');

      // C++ sends CACHE_ADDR (0xf2) BEFORE the player list (DPLoginSrvr.cpp:167).
      // It carries the world/cache server IP the client dials on :5400 when a
      // character is selected. Without it m_lpCacheAddr stays empty and the
      // client hangs on "connecting please wait" (WndTitle.cpp:2105).
      this.sendCacheAddr(socket);
      // C++ sends LOGIN_PROTECT_NUMPAD (0x88100200) right after CACHE_ADDR
      // (DPLoginSrvr.cpp:170). Client stores the id and uses it to pick a row
      // from its hardcoded byNumberTable[1000][10] (Wnd2ndPassword.cpp:397).
      // Without this the client defaults to id=0 -- same layout every session.
      this.sendNumPadId(socket);
      await this.sendPlayerList(socket, authKey, account);
    } catch (error) {
      logger.error({ error }, 'GETPLAYERLIST failed');
    }
  }

  /** PACKETTYPE_CREATE_PLAYER (0xf4) -> PLAYER_LIST on success, ERROR on failure. */
  async handleCreatePlayer(socket: Socket, reader: PacketReader): Promise<void> {
    try {
      const account = reader.readString();
      const _password = reader.readString();
      const slot = reader.readByte();
      const name = reader.readString();
      const _face = reader.readByte();
      const _costume = reader.readByte();
      const skinSet = reader.readByte();
      const hairMesh = reader.readByte();
      const hairColor = reader.readDword();
      const sex = reader.readByte();
      const job = reader.readByte();
      const headMesh = reader.readByte();
      const _bankPW = reader.readLong();
      const authKey = reader.readDword();

      const result = await this.charCreateService.create({
        account, slot, name, skinSet, hairMesh, hairColor, headMesh, sex, job,
      });

      if (result.ok) {
        await this.sendPlayerList(socket, authKey, account);
      } else {
        this.sendError(socket, result.errorCode);
      }
    } catch (error) {
      logger.error({ error }, 'CREATE_PLAYER failed');
      this.sendError(socket, 0);
    }
  }

  /** PACKETTYPE_DEL_PLAYER (0xf5) -> PLAYER_LIST on success, ERROR on failure. */
  async handleDeletePlayer(socket: Socket, reader: PacketReader): Promise<void> {
    try {
      const account = reader.readString();
      const _password = reader.readString();
      const _deleteKey = reader.readString();
      const idPlayer = reader.readDword();
      const authKey = reader.readDword();

      const result = await this.charCreateService.delete(account, idPlayer);

      if (result.ok) {
        await this.sendPlayerList(socket, authKey, account);
      } else {
        this.sendError(socket, result.errorCode);
      }
    } catch (error) {
      logger.error({ error }, 'DEL_PLAYER failed');
      this.sendError(socket, 0);
    }
  }

  /**
   * PACKETTYPE_PRE_JOIN (0xff05) -- select char to enter world.
   * Reply is a bare PRE_JOIN opcode (no payload), matching C++ SendHdr.
   * SEL_PLAYER (0xf7) is dead code in the C++ source.
   */
  async handlePreJoin(socket: Socket, reader: PacketReader): Promise<void> {
    try {
      const account = reader.readString();
      const idPlayer = reader.readDword();
      const name = reader.readString();
      const _bankPW = reader.readLong();

      const result = await this.charSelectService.prejoin(account, idPlayer, name);
      if (!result.ok) {
        logger.warn({ account, idPlayer }, 'PRE_JOIN rejected');
        return;
      }

      const writer = new PacketWriter();
      writer.writeDword(PACKETTYPE.PRE_JOIN);
      sendPacket(socket, writer.build());
    } catch (error) {
      logger.error({ error }, 'PRE_JOIN failed');
    }
  }

  /**
   * Send CACHE_ADDR (0xf2): the world/cache server address the client dials on
   * :5400 to enter the game. Payload is a single length-prefixed string, matching
   * C++ `SendCacheAddr` (DPLoginSrvr.cpp:114-119). Falls back to 127.0.0.1 when
   * no world has registered yet (dev single-box default).
   */
  private sendCacheAddr(socket: Socket): void {
    const addr = this.cacheAddrSource.getCacheAddr() ?? '127.0.0.1';
    const writer = new PacketWriter();
    writer.writeDword(PACKETTYPE.CACHE_ADDR);
    writer.writeString(addr);
    sendPacket(socket, writer.build());
  }

  /**
   * Send LOGIN_PROTECT_NUMPAD (0x88100200) with a random id 0-999.
   *
   * Client maps the id to a row in byNumberTable[1000][10] (Wnd2ndPassword.cpp:397)
   * so the digit layout on the PIN pad differs every session. Cosmetic only --
   * the emulator does not validate the 2nd password server-side.
   * ponytail: full validation via CLoginProtect::GetNumPad2PW when 2nd-password DB column added.
   */
  private sendNumPadId(socket: Socket): void {
    const idNumPad = Math.floor(Math.random() * 1000);
    const writer = new PacketWriter();
    writer.writeDword(PACKETTYPE.LOGIN_PROTECT_NUMPAD);
    writer.writeDword(idNumPad);
    sendPacket(socket, writer.build());
  }

  /** Build + send a fresh PLAYER_LIST for `account`, echoing `authKey`. */
  private async sendPlayerList(socket: Socket, authKey: number, account: string): Promise<void> {
    const chars = await this.charListService.listByAccount(account);
    sendPacket(socket, this.playerListSerializer.build(authKey, chars));
  }

  /** Send a PACKETTYPE_ERROR packet with the given error code. */
  private sendError(socket: Socket, errorCode: number): void {
    const writer = new PacketWriter();
    writer.writeDword(PACKETTYPE.ERROR);
    writer.writeDword(errorCode);
    sendPacket(socket, writer.build());
  }
}

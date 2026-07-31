/**
 * Trade handlers -- the 10 `PACKETTYPE_TRADE*` / `CONFIRMTRADE*` opcodes.
 *
 * Bodies (`WORLDSERVER/DPSrvr.cpp`, confirmed against `Neuz/DPClient.cpp` sends):
 *   CONFIRMTRADE / CONFIRMTRADECANCEL / TRADE : `OBJID objidTrader`
 *   TRADEPUT                                  : `BYTE i, BYTE nItemType, BYTE nId, short nItemNum`
 *   TRADEPULL                                 : `BYTE i`
 *   TRADEPUTGOLD                              : `DWORD dwGold`
 *   TRADECANCEL                               : `int nMode`
 *   TRADEOK / TRADECONFIRM                    : bodyless
 *   TRADECLEARGOLD                            : bodyless -- handler is commented
 *                                               out in v19 C++ (DPSrvr.cpp:8838),
 *                                               so we accept and drop it.
 *
 * @module handlers/trade.handler
 */

import type { PacketReader } from '@flyff/core/net/PacketReader';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { Validate } from '@flyff/core/utils/validate';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { CPlayer } from '@flyff/entities';
import type { TradeService } from '../services/trade.service';

const logger = createLogger({ module: 'trade-handler' });

export class TradeHandler {
  constructor(
    private playerManager: PlayerManager,
    private tradeService: TradeService,
  ) {}

  handleConfirmTrade(socket: ClientSocket, reader: PacketReader): void {
    this.withObjid(socket, reader, 'CONFIRMTRADE',
      (p, objid) => this.tradeService.confirmTrade(p, objid));
  }

  handleConfirmTradeCancel(socket: ClientSocket, reader: PacketReader): void {
    this.withObjid(socket, reader, 'CONFIRMTRADECANCEL',
      (p, objid) => this.tradeService.confirmTradeCancel(p, objid));
  }

  handleTrade(socket: ClientSocket, reader: PacketReader): void {
    this.withObjid(socket, reader, 'TRADE',
      (p, objid) => this.tradeService.trade(p, objid));
  }

  handleTradePut(socket: ClientSocket, reader: PacketReader): void {
    const player = this.resolve(socket);
    if (!player) return;
    try {
      const index = reader.readByte();
      const itemType = reader.readByte();
      const slot = reader.readByte();
      const count = reader.readWord();     // short
      const out = this.tradeService.put(player, index, itemType, slot, count);
      logger.debug({ charId: player.m_idPlayer, index, slot, count, out }, 'TRADEPUT');
    } catch (error) {
      this.onParseError(error, player, 'TRADEPUT');
    }
  }

  handleTradePull(socket: ClientSocket, reader: PacketReader): void {
    const player = this.resolve(socket);
    if (!player) return;
    try {
      const index = reader.readByte();
      const out = this.tradeService.pull(player, index);
      logger.debug({ charId: player.m_idPlayer, index, out }, 'TRADEPULL');
    } catch (error) {
      this.onParseError(error, player, 'TRADEPULL');
    }
  }

  handleTradePutGold(socket: ClientSocket, reader: PacketReader): void {
    const player = this.resolve(socket);
    if (!player) return;
    try {
      const gold = reader.readDword();
      Validate.dword(gold);
      const out = this.tradeService.putGold(player, gold);
      logger.debug({ charId: player.m_idPlayer, gold, out }, 'TRADEPUTGOLD');
    } catch (error) {
      this.onParseError(error, player, 'TRADEPUTGOLD');
    }
  }

  /**
   * TRADECLEARGOLD -- the C++ handler is commented out in v19
   * (`DPSrvr.cpp:8838`), so the server ignores it. Registered only so the opcode
   * stops logging as unknown; clearing a gold stake goes through cancel.
   */
  handleTradeClearGold(socket: ClientSocket): void {
    const player = this.resolve(socket);
    if (!player) return;
    logger.debug({ charId: player.m_idPlayer }, 'TRADECLEARGOLD ignored (no v19 handler)');
  }

  handleTradeOk(socket: ClientSocket): void {
    const player = this.resolve(socket);
    if (!player) return;
    const out = this.tradeService.ok(player);
    logger.debug({ charId: player.m_idPlayer, out }, 'TRADEOK');
  }

  handleTradeConfirm(socket: ClientSocket): void {
    const player = this.resolve(socket);
    if (!player) return;
    const out = this.tradeService.lastConfirm(player);
    logger.debug({ charId: player.m_idPlayer, out }, 'TRADECONFIRM');
  }

  handleTradeCancel(socket: ClientSocket, reader: PacketReader): void {
    const player = this.resolve(socket);
    if (!player) return;
    try {
      const mode = reader.readDword() | 0;   // int nMode
      const out = this.tradeService.cancel(player, mode);
      logger.debug({ charId: player.m_idPlayer, mode, out }, 'TRADECANCEL');
    } catch (error) {
      this.onParseError(error, player, 'TRADECANCEL');
    }
  }

  private withObjid(
    socket: ClientSocket, reader: PacketReader, label: string,
    run: (player: CPlayer, objid: number) => unknown,
  ): void {
    const player = this.resolve(socket);
    if (!player) return;
    try {
      const objid = reader.readDword();
      Validate.dword(objid);
      const out = run(player, objid);
      logger.debug({ charId: player.m_idPlayer, objid, out }, label);
    } catch (error) {
      this.onParseError(error, player, label);
    }
  }

  private resolve(socket: ClientSocket): CPlayer | undefined {
    if (socket.session.state !== SessionState.IN_WORLD) { socket.destroy(); return undefined; }
    const player = this.playerManager.get(socket.session.charId ?? -1);
    if (!player) { socket.destroy(); return undefined; }
    return player;
  }

  private onParseError(error: unknown, player: CPlayer, label: string): void {
    if (error instanceof PacketError) {
      logger.warn({ err: error, charId: player.m_idPlayer }, `${label} parse failed`);
      return;
    }
    throw error;
  }
}

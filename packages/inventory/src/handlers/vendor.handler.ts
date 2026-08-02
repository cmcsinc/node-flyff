/**
 * Vendor handlers -- the 6 private-shop (vending) opcodes.
 *
 * Bodies (`WORLDSERVER/DPSrvr.cpp`, cross-checked against `Neuz/DPClient.cpp`):
 *   PVENDOR_OPEN             : DWORD-prefixed `szPVendor[48]` title
 *   PVENDOR_CLOSE            : `OBJID objidVendor`
 *   REGISTER_PVENDOR_ITEM    : `BYTE iIndex, BYTE nType, BYTE nId, short nNum, int nCost`
 *   UNREGISTER_PVENDOR_ITEM  : `BYTE i`
 *   QUERY_PVENDOR_ITEM       : `OBJID objidVendor`
 *   BUY_PVENDOR_ITEM         : `OBJID objidVendor, BYTE nItem, DWORD dwItemId, short nNum`
 *
 * `nType` in REGISTER is wire-only -- the server ignores it (echoes 0).
 *
 * @module handlers/vendor.handler
 */

import type { PacketReader } from '@flyff/core/net/PacketReader';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { Validate } from '@flyff/core/utils/validate';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { CPlayer } from '@flyff/entities';
import type { VendorService } from '../services/vendor.service';

const logger = createLogger({ module: 'vendor-handler' });

export class VendorHandler {
  constructor(
    private playerManager: PlayerManager,
    private vendorService: VendorService,
  ) {}

  handlePVendorOpen(socket: ClientSocket, reader: PacketReader): void {
    const player = this.resolve(socket);
    if (!player) return;
    try {
      const title = reader.readString();
      Validate.string(title, 1, 48);
      const out = this.vendorService.open(player, title);
      logger.info({ charId: player.m_idPlayer, out }, 'PVENDOR_OPEN');
    } catch (error) {
      this.onParseError(error, player, 'PVENDOR_OPEN');
    }
  }

  handlePVendorClose(socket: ClientSocket, reader: PacketReader): void {
    this.withObjid(socket, reader, 'PVENDOR_CLOSE',
      (p, objid) => this.vendorService.close(p, objid));
  }

  handleRegisterPVendorItem(socket: ClientSocket, reader: PacketReader): void {
    const player = this.resolve(socket);
    if (!player) return;
    try {
      const iIndex = reader.readByte();
      const nType = reader.readByte();   // wire-only; ignored by the service
      const nId = reader.readByte();
      const nNum = reader.readWord();
      const nCost = reader.readDword();
      Validate.dword(nCost);
      const out = this.vendorService.registerItem(player, iIndex, nId, nNum, nCost);
      logger.info({ charId: player.m_idPlayer, iIndex, nType, nId, nNum, nCost, out },
        'REGISTER_PVENDOR_ITEM');
    } catch (error) {
      this.onParseError(error, player, 'REGISTER_PVENDOR_ITEM');
    }
  }

  handleUnregisterPVendorItem(socket: ClientSocket, reader: PacketReader): void {
    const player = this.resolve(socket);
    if (!player) return;
    try {
      const i = reader.readByte();
      const out = this.vendorService.unregisterItem(player, i);
      logger.info({ charId: player.m_idPlayer, i, out }, 'UNREGISTER_PVENDOR_ITEM');
    } catch (error) {
      this.onParseError(error, player, 'UNREGISTER_PVENDOR_ITEM');
    }
  }

  handleQueryPVendorItem(socket: ClientSocket, reader: PacketReader): void {
    this.withObjid(socket, reader, 'QUERY_PVENDOR_ITEM',
      (p, objid) => this.vendorService.query(p, objid));
  }

  handleBuyPVendorItem(socket: ClientSocket, reader: PacketReader): void {
    const player = this.resolve(socket);
    if (!player) return;
    try {
      const objidVendor = reader.readDword();
      const nItem = reader.readByte();
      const dwItemId = reader.readDword();
      const nNum = reader.readWord();
      Validate.dword(objidVendor);
      Validate.dword(dwItemId);
      const out = this.vendorService.buy(player, objidVendor, nItem, dwItemId, nNum);
      logger.info(
        { charId: player.m_idPlayer, objidVendor, nItem, dwItemId, nNum, out },
        'BUY_PVENDOR_ITEM');
    } catch (error) {
      this.onParseError(error, player, 'BUY_PVENDOR_ITEM');
    }
  }

  // ── shared ────────────────────────────────────────────────────────────────

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
      logger.info({ charId: player.m_idPlayer, objid, out }, label);
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

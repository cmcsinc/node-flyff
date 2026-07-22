/**
 * Shop handlers -- OPENSHOPWND / CLOSESHOPWND.
 *
 * `WORLDSERVER/DPSrvr.cpp`:
 *   OPENSHOPWND  0x00ff00b1 (:2744): `OBJID objid` (the vendor NPC)
 *   CLOSESHOPWND 0x00ff00b2 (:2793): bodyless
 *
 * Open validates the vendor + acks with SNAPSHOTTYPE_OPENSHOPWND (4 empty shop
 * tabs). Close just clears the player's interacting-other. Rejected opens send
 * nothing (matches C++ silent `return`).
 *
 * @module handlers/shop
 */

import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { Validate } from '@flyff/core/utils/validate.js';
import type { ClientSocket } from '@flyff/core/net/dispatcher.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { PacketError } from '@flyff/core/errors.js';
import { createLogger } from '@flyff/core/logger.js';
import type { PlayerManager } from '../managers/player.manager.js';
import type { ShopService } from '../services/shop.service.js';
import { buildOpenShopWnd } from '../net/snapshot/shop.serializer.js';

const logger = createLogger({ module: 'shop-handler' });

export interface ShopHandlerDeps {
  playerManager: PlayerManager;
  shopService: ShopService;
}

export class ShopHandler {
  constructor(private readonly deps: ShopHandlerDeps) {}

  handleOpen(socket: ClientSocket, reader: PacketReader): void { this.run(socket, reader, (p, r) => {
    const objid = r.readDword();
    Validate.dword(objid);
    const res = this.deps.shopService.open(p, objid);
    if (!res.ok) return;
    this.deps.playerManager.sendTo(p, buildOpenShopWnd(res.vendorId, res.stock));
  }); }

  handleClose(socket: ClientSocket, reader: PacketReader): void { this.run(socket, reader, (p) => {
    this.deps.shopService.close(p);
  }); }

  /** Shared session/player guard + PacketError swallow. */
  private run(
    socket: ClientSocket,
    reader: PacketReader,
    body: (player: NonNullable<ReturnType<PlayerManager['get']>>, reader: PacketReader) => void,
  ): void {
    if (socket.session.state !== SessionState.IN_WORLD) { socket.destroy(); return; }
    const player = this.deps.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }
    try {
      body(player, reader);
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'shop parse failed');
        return;
      }
      throw error;
    }
  }
}

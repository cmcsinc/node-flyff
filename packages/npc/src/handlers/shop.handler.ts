/**
 * Shop handlers -- OPENSHOPWND / CLOSESHOPWND / BUYITEM / SELLITEM.
 *
 * `WORLDSERVER/DPSrvr.cpp`:
 *   OPENSHOPWND  0x00ff00b1 (:2744): `OBJID objid` (the vendor NPC)
 *   CLOSESHOPWND 0x00ff00b2 (:2793): bodyless
 *   BUYITEM      0x00ff00b3 (:2804):  `CHAR cTab, BYTE nId, short nNum, DWORD dwItemId`
 *   SELLITEM     0x00ff00b4 (:3074):  `BYTE nId, short nNum` (nId = item objid / STABLE m_dwObjId)
 *
 * Open validates the vendor + acks with SNAPSHOTTYPE_OPENSHOPWND (4 empty shop
 * tabs). Close just clears the player's interacting-other. Buy/sell delegate to
 * {@link ShopService} and ack with the inventory slot delta (CREATEITEM for a
 * fresh slot, UPDATE_ITEM for a stack-merge or a sell) plus SETPOINTPARAM
 * (DST_GOLD) for the new penya balance. Rejected paths send nothing -- matches
 * C++ silent `return` (ponytail: DEFINEDTEXT TID_GAME_LACKMONEY / LACKSPACE).
 *
 * @module handlers/shop
 */

import { PacketReader } from '@flyff/core/net/PacketReader';
import { Validate } from '@flyff/core/utils/validate';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { ShopService } from '../services/shop.service';
import { buildOpenShopWnd } from '../net/snapshot/shop.serializer';
import { buildUpdateItemCount } from '@flyff/inventory';
import { buildSetPointParam, DST_GOLD } from '@flyff/world-core';
import { CreateItemSnapshotSerializer } from '@flyff/inventory';

const logger = createLogger({ module: 'shop-handler' });

export interface ShopHandlerDeps {
  playerManager: PlayerManager;
  shopService: ShopService;
  /** CREATEITEM snapshot builder -- defaults to a fresh instance (mirrors actMsg). */
  createItemSerializer?: CreateItemSnapshotSerializer;
}

export class ShopHandler {
  private readonly createItemSerializer: CreateItemSnapshotSerializer;
  constructor(deps: ShopHandlerDeps) {
    this.deps = deps;
    this.createItemSerializer = deps.createItemSerializer ?? new CreateItemSnapshotSerializer();
  }
  private readonly deps: ShopHandlerDeps;

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

  /** BUYITEM -- `CHAR cTab, BYTE nId, short nNum, DWORD dwItemId`. */
  handleBuy(socket: ClientSocket, reader: PacketReader): void { this.run(socket, reader, (p, r) => {
    const cTab = r.readByte();
    const nId = r.readByte();
    const nNum = r.readWord();
    const dwItemId = r.readDword();
    Validate.dword(dwItemId);
    const res = this.deps.shopService.buy(p, cTab, nId, nNum, dwItemId);
    if (!res.ok) {
      logger.warn({ charId: p.m_idPlayer, reason: res.reason, cTab, nId, nNum, dwItemId, gold: p.m_nGold, other: p.m_idOther }, 'BUYITEM rejected');
      return;
    }
    // Both UPDATE_ITEM (stack merge) and CREATEITEM (new slot) address by the
    // client's STABLE m_dwObjId, NOT the bag index: OnCreateItem does
    // SetAtId(nId) and C++ Add sends nId = m_apIndex[i] (Item.h:720). After
    // equipping out of a slot the objid drifts from the slot, so keying by slot
    // lands the item in the equipped item's cell (weapon-in-shield-slot bug).
    this.deps.playerManager.sendTo(p, res.isNew
      ? this.createItemSerializer.buildOne(p.m_idPlayer, res.itemId, res.count, res.objid)
      : buildUpdateItemCount(p.m_idPlayer, res.objid, res.count));
    this.deps.playerManager.sendTo(p, buildSetPointParam(p.m_idPlayer, DST_GOLD, res.gold));
    logger.info({ charId: p.m_idPlayer, itemId: res.itemId, count: res.count, slot: res.slot, gold: res.gold }, 'BUYITEM ok');
  }); }

  /** SELLITEM -- `BYTE nId, short nNum` (nId = item objid / STABLE m_dwObjId). */
  handleSell(socket: ClientSocket, reader: PacketReader): void { this.run(socket, reader, (p, r) => {
    const nId = r.readByte();
    const nNum = r.readWord();
    const res = this.deps.shopService.sell(p, nId, nNum);
    if (!res.ok) {
      logger.warn({ charId: p.m_idPlayer, reason: res.reason, nId, nNum, gold: p.m_nGold, other: p.m_idOther }, 'SELLITEM rejected');
      return;
    }
    // UPDATE_ITEM with the post-sell count; count 0 clears the slot client-side.
    // nId MUST be the item's STABLE m_dwObjId, not the slot: the client resolves
    // it via GetAtId(nId) (Mover.cpp:8528 C++ sends pItemElem->m_dwObjId). `nId`
    // here IS the wire objid (see service comment). Passing res.slot leaves the
    // icon stuck when a moved item's objid != its slot (the sell-ghost bug).
    this.deps.playerManager.sendTo(p, buildUpdateItemCount(p.m_idPlayer, nId, res.remaining));
    this.deps.playerManager.sendTo(p, buildSetPointParam(p.m_idPlayer, DST_GOLD, res.gold));
    logger.info({ charId: p.m_idPlayer, itemId: res.itemId, remaining: res.remaining, gold: res.gold }, 'SELLITEM ok');
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

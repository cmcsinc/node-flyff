/**
 * Bank handlers — OPEN/CLOSE bank + item/gold deposit & withdraw.
 *
 * `WORLDSERVER/DPSrvr.cpp`:
 *   OPENBANKWND   0xffffff40 (:3200): `DWORD dwId, DWORD dwItemId` (dwId=NULL_ID ⇒ NPC bank)
 *   CLOSEBANKWND  0xffffff41 (:3255): bodyless
 *   PUTITEMBACK   0xffffff42 (:3430): `BYTE nSlot(tab), BYTE nId(inv slot), short nItemNum`
 *   GETITEMBACK   0xffffff44 (:3791): `BYTE nSlot(tab), BYTE nId(bank slot), short nItemNum`
 *   PUTGOLDBACK   0xffffff43 (:3848): `BYTE nSlot(tab), DWORD dwGold`
 *   GETGOLDBACK   0xffffff45 (:3900): `BYTE nSlot(tab), DWORD dwGold`
 *
 * Each acks with the matching Add*Bank snapshot (User.cpp:965+).
 *
 * @module handlers/bank
 */

import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { Validate } from '@flyff/core/utils/validate.js';
import type { ClientSocket } from '@flyff/core/net/dispatcher.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { PacketError } from '@flyff/core/errors.js';
import { createLogger } from '@flyff/core/logger.js';
import type { PlayerManager } from '../managers/player.manager.js';
import type { BankService } from '../services/bank.service.js';
import {
  buildPutItemBank, buildGetItemBank, buildPutGoldBank, buildGetGoldBank, buildBankWindow,
} from '../net/snapshot/bank.serializer.js';

const logger = createLogger({ module: 'bank-handler' });

export interface BankHandlerDeps {
  playerManager: PlayerManager;
  bankService: BankService;
}

export class BankHandler {
  constructor(private readonly deps: BankHandlerDeps) {}

  handleOpen(socket: ClientSocket, reader: PacketReader): void { this.run(socket, reader, (p, r) => {
    const dwId = r.readDword();
    const dwItemId = r.readDword();
    Validate.dword(dwId);
    this.deps.bankService.open(p);
    this.deps.playerManager.sendTo(p, buildBankWindow(p.m_idPlayer, 1, dwId, dwItemId));
  }); }

  handleClose(socket: ClientSocket, _reader: PacketReader): void { this.run(socket, null, (p) => {
    this.deps.bankService.close(p);
  }); }

  handleDeposit(socket: ClientSocket, reader: PacketReader): void { this.run(socket, reader, (p, r) => {
    const tab = r.readByte();
    const nId = r.readByte();
    const nItemNum = r.readWord();
    const res = this.deps.bankService.deposit(p, tab, nId, nItemNum);
    if (!res.ok) return;
    this.deps.playerManager.sendTo(p, buildPutItemBank(p.m_idPlayer, res.tab, res.bankSlot, res.item));
  }); }

  handleWithdraw(socket: ClientSocket, reader: PacketReader): void { this.run(socket, reader, (p, r) => {
    const tab = r.readByte();
    const nId = r.readByte();
    const nItemNum = r.readWord();
    const res = this.deps.bankService.withdraw(p, tab, nId, nItemNum);
    if (!res.ok) return;
    this.deps.playerManager.sendTo(p, buildGetItemBank(p.m_idPlayer, nId, res.item));
  }); }

  handleDepositGold(socket: ClientSocket, reader: PacketReader): void { this.run(socket, reader, (p, r) => {
    const tab = r.readByte();
    const dwGold = r.readDword();
    Validate.dword(dwGold);
    const res = this.deps.bankService.depositGold(p, dwGold);
    if (!res.ok) return;
    this.deps.playerManager.sendTo(p, buildPutGoldBank(p.m_idPlayer, res.tab, res.invGold, res.bankGold));
    void tab;
  }); }

  handleWithdrawGold(socket: ClientSocket, reader: PacketReader): void { this.run(socket, reader, (p, r) => {
    const tab = r.readByte();
    const dwGold = r.readDword();
    Validate.dword(dwGold);
    const res = this.deps.bankService.withdrawGold(p, dwGold);
    if (!res.ok) return;
    this.deps.playerManager.sendTo(p, buildGetGoldBank(p.m_idPlayer, res.tab, res.invGold, res.bankGold));
    void tab;
  }); }

  /** Shared session/player guard + PacketError swallow. */
  private run(
    socket: ClientSocket,
    reader: PacketReader | null,
    body: (player: NonNullable<ReturnType<PlayerManager['get']>>, reader: PacketReader) => void,
  ): void {
    if (socket.session.state !== SessionState.IN_WORLD) { socket.destroy(); return; }
    const player = this.deps.playerManager.get(socket.session.charId!);
    if (!player) { socket.destroy(); return; }
    try {
      body(player, reader ?? new PacketReader(Buffer.alloc(0)));
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'bank parse failed');
        return;
      }
      throw error;
    }
  }
}

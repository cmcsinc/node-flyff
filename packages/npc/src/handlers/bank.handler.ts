/**
 * Bank handlers -- OPEN/CLOSE bank + item/gold deposit & withdraw.
 *
 * `WORLDSERVER/DPSrvr.cpp`:
 *   OPENBANKWND   0xffffff40 (:3200): `DWORD dwId, DWORD dwItemId` (dwId=NULL_ID => NPC bank)
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

import type { PacketReader } from '@flyff/core/net/PacketReader';
import { Validate } from '@flyff/core/utils/validate';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { BankService } from '../services/bank.service';
import {
  buildPutItemBank, buildGetItemBank, buildPutGoldBank, buildGetGoldBank, buildBankWindow,
  buildConfirmBankPass, buildChangeBankPass,
} from '../net/snapshot/bank.serializer';

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
    // nMode from BankService.open: 0 = no pin (set-pin dialog), 1 = pin set
    // (enter-pin dialog). -1 = rejected (no nearby bank NPC or chaotic).
    // Matches C++ OnOpenBankWnd/AddBankWindow (DPSrvr.cpp:3218).
    const nMode = this.deps.bankService.open(p, dwId);
    if (nMode < 0) return;
    this.deps.playerManager.sendTo(p, buildBankWindow(p.m_idPlayer, nMode, dwId, dwItemId));
  }); }

  /**
   * CONFIRMBANK (0xffffff48) -- `OnConfirmBank:3991`. Body:
   * `String szPass(10), DWORD dwId, DWORD dwItemId`. Ack CONFIRMBANKPASS with
   * nMode 1 (accepted, open bank) or 0 (wrong, re-prompt).
   */
  handleConfirmBankPass(socket: ClientSocket, reader: PacketReader): void { this.run(socket, reader, (p, r) => {
    const szPass = r.readString();
    const dwId = r.readDword();
    const dwItemId = r.readDword();
    Validate.dword(dwId);
    const res = this.deps.bankService.confirmBankPass(p, szPass, dwId, dwItemId);
    this.deps.playerManager.sendTo(p, buildConfirmBankPass(p.m_idPlayer, res.ok ? 1 : 0, res.dwId, res.dwItemId));
  }); }

  /**
   * CHANGEBANKPASS (0xffffff47) -- `OnChangeBankPass:3955`. Body:
   * `String szLastPass, String szNewPass, DWORD dwId, DWORD dwItemId`. Acks
   * CHANGEBANKPASS with nMode 1 (old matched, new saved) or 0 (rejected).
   */
  handleChangeBankPass(socket: ClientSocket, reader: PacketReader): void { this.run(socket, reader, (p, r) => {
    const szLastPass = r.readString();
    const szNewPass = r.readString();
    const dwId = r.readDword();
    const dwItemId = r.readDword();
    Validate.dword(dwId);
    const res = this.deps.bankService.changeBankPass(p, szLastPass, szNewPass, dwId, dwItemId);
    this.deps.playerManager.sendTo(p, buildChangeBankPass(p.m_idPlayer, res.ok ? 1 : 0, res.dwId, res.dwItemId));
  }); }

  handleClose(socket: ClientSocket, reader: PacketReader): void { this.run(socket, reader, (p) => {
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
    const res = this.deps.bankService.depositGold(p, tab, dwGold);
    if (!res.ok) return;
    this.deps.playerManager.sendTo(p, buildPutGoldBank(p.m_idPlayer, res.tab, res.invGold, res.bankGold));
  }); }

  handleWithdrawGold(socket: ClientSocket, reader: PacketReader): void { this.run(socket, reader, (p, r) => {
    const tab = r.readByte();
    const dwGold = r.readDword();
    Validate.dword(dwGold);
    const res = this.deps.bankService.withdrawGold(p, tab, dwGold);
    if (!res.ok) return;
    this.deps.playerManager.sendTo(p, buildGetGoldBank(p.m_idPlayer, res.tab, res.invGold, res.bankGold));
  }); }

  /** Shared session/player guard + PacketError swallow. */
  private run(
    socket: ClientSocket,
    reader: PacketReader,
    body: (player: NonNullable<ReturnType<PlayerManager['get']>>, reader: PacketReader) => void,
  ): void {
    if (socket.session.state !== SessionState.IN_WORLD) { socket.destroy(); return; }
    const charId = socket.session.charId;
    if (charId === undefined) { socket.destroy(); return; }
    const player = this.deps.playerManager.get(charId);
    if (!player) { socket.destroy(); return; }
    try {
      body(player, reader);
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer }, 'bank parse failed');
        return;
      }
      throw error;
    }
  }
}

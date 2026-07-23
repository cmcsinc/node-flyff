/**
 * BankHandler test -- OPEN/CLOSE bank + item/gold deposit & withdraw acks.
 *
 * PUTITEMBACK body: `BYTE nSlot(tab), BYTE nId(inv slot), short nItemNum`.
 * Each ack sends the matching Add*Bank snapshot subtype (0x0050/0x0051/0x0052/
 * 0x0056). A rejected op sends nothing.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { SessionState } from '@flyff/core/constants/sessionState';
import { BankHandler } from '../../src/handlers/bank.handler';
import { SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import type { CPlayer } from '../../src/entities/player';
import type { PlayerManager } from '../../src/managers/player.manager';
import type { BankService } from '../../src/services/bank.service';

function mockSocket() {
  return { session: { state: SessionState.IN_WORLD, charId: 42 }, write: () => true, destroy: () => {} } as never;
}

function subtype(buf: Buffer): number {
  return buf.readUInt16LE(14);
}

function makeHandler(stub: {
  deposit?: unknown;
  withdraw?: unknown;
  depositGold?: unknown;
  withdrawGold?: unknown;
}) {
  const sent: Buffer[] = [];
  const player = { m_idPlayer: 0xcccc } as unknown as CPlayer;
  const playerManager = { get: () => player, sendTo: (_p: CPlayer, b: Buffer) => { sent.push(b); } } as unknown as PlayerManager;
  const bankService = {
    open: () => 1,
    close: () => {},
    confirmBankPass: (_p: CPlayer, _pass: string, dwId: number, dwItemId: number) => ({ ok: true, dwId, dwItemId }),
    changeBankPass: (_p: CPlayer, _last: string, _next: string, dwId: number, dwItemId: number) => ({ ok: true, dwId, dwItemId }),
    deposit: () => stub.deposit,
    withdraw: () => stub.withdraw,
    depositGold: () => stub.depositGold,
    withdrawGold: () => stub.withdrawGold,
  } as unknown as BankService;
  const handler = new BankHandler({ playerManager, bankService });
  return { handler, sent };
}

describe('BankHandler', () => {
  it('handleDeposit acks PUTITEMBANK on success', () => {
    const w = new PacketWriter();
    w.writeByte(0); w.writeByte(3); w.writeWord(5); // tab=0, invSlot=3, nItemNum=5
    const { handler, sent } = makeHandler({
      deposit: { ok: true, tab: 0, bankSlot: 2, item: { itemId: 2950, count: 5 } },
    });
    handler.handleDeposit(mockSocket(), new PacketReader(w.build()));
    assert.equal(sent.length, 1);
    assert.equal(subtype(sent[0]!), SNAPSHOTTYPE.PUTITEMBANK);
  });

  it('handleDeposit sends nothing when the service rejects', () => {
    const w = new PacketWriter();
    w.writeByte(0); w.writeByte(3); w.writeWord(5);
    const { handler, sent } = makeHandler({ deposit: { ok: false, reason: 'bank_full' } });
    handler.handleDeposit(mockSocket(), new PacketReader(w.build()));
    assert.equal(sent.length, 0);
  });

  it('handleWithdraw acks GETITEMBANK on success', () => {
    const w = new PacketWriter();
    w.writeByte(0); w.writeByte(2); w.writeWord(1);
    const { handler, sent } = makeHandler({
      withdraw: { ok: true, tab: 0, bankSlot: 2, item: { itemId: 1234, count: 1 } },
    });
    handler.handleWithdraw(mockSocket(), new PacketReader(w.build()));
    assert.equal(sent.length, 1);
    assert.equal(subtype(sent[0]!), SNAPSHOTTYPE.GETITEMBANK);
  });

  it('handleDepositGold acks PUTGOLDBANK on success', () => {
    const w = new PacketWriter();
    w.writeByte(0); w.writeDword(400);
    const { handler, sent } = makeHandler({
      depositGold: { ok: true, tab: 0, invGold: 600, bankGold: 400 },
    });
    handler.handleDepositGold(mockSocket(), new PacketReader(w.build()));
    assert.equal(sent.length, 1);
    assert.equal(subtype(sent[0]!), SNAPSHOTTYPE.PUTGOLDBANK);
  });

  it('handleOpen acks BANKWINDOW, forwarding the nMode from BankService.open', () => {
    const w = new PacketWriter();
    w.writeDword(0xffffffff); w.writeDword(0); // dwId=NULL_ID, dwItemId=0
    const { handler, sent } = makeHandler({});
    handler.handleOpen(mockSocket(), new PacketReader(w.build()));
    assert.equal(sent.length, 1);
    assert.equal(subtype(sent[0]!), SNAPSHOTTYPE.BANKWINDOW);
    assert.equal(sent[0]!.readUInt32LE(16), 1, 'forwards service nMode (1 = pin set)');
  });

  it('handleConfirmBankPass acks CONFIRMBANKPASS (nMode=1 accepted)', () => {
    const w = new PacketWriter();
    w.writeString('0000'); w.writeDword(0xffffffff); w.writeDword(0);
    const { handler, sent } = makeHandler({});
    handler.handleConfirmBankPass(mockSocket(), new PacketReader(w.build()));
    assert.equal(sent.length, 1);
    assert.equal(subtype(sent[0]!), SNAPSHOTTYPE.CONFIRMBANKPASS);
    assert.equal(sent[0]!.readUInt32LE(16), 1, 'nMode = accepted');
  });

  it('handleClose sends no snapshot (bodyless ack)', () => {
    const { handler, sent } = makeHandler({});
    handler.handleClose(mockSocket(), new PacketReader(Buffer.alloc(1)));
    assert.equal(sent.length, 0);
  });

  it('handleChangeBankPass acks CHANGEBANKPASS (nMode=1 on match)', () => {
    const w = new PacketWriter();
    w.writeString('1234'); w.writeString('4321'); w.writeDword(0xffffffff); w.writeDword(0);
    const { handler, sent } = makeHandler({});
    handler.handleChangeBankPass(mockSocket(), new PacketReader(w.build()));
    assert.equal(sent.length, 1);
    assert.equal(subtype(sent[0]!), SNAPSHOTTYPE.CHANGEBANKPASS);
    assert.equal(sent[0]!.readUInt32LE(16), 1, 'nMode = old matched, saved');
  });
});

/**
 * BankHandler test — OPEN/CLOSE bank + item/gold deposit & withdraw acks.
 *
 * PUTITEMBACK body: `BYTE nSlot(tab), BYTE nId(inv slot), short nItemNum`.
 * Each ack sends the matching Add*Bank snapshot subtype (0x0050/0x0051/0x0052/
 * 0x0056). A rejected op sends nothing.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { BankHandler } from '../../src/handlers/bank.handler.js';
import { SNAPSHOTTYPE } from '@flyff/core/constants/opcodes.js';
import type { CPlayer } from '../../src/entities/player.js';
import type { PlayerManager } from '../../src/managers/player.manager.js';
import type { BankService } from '../../src/services/bank.service.js';

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
    open: () => true,
    close: () => {},
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

  it('handleOpen acks BANKWINDOW (nMode=1)', () => {
    const w = new PacketWriter();
    w.writeDword(0xffffffff); w.writeDword(0); // dwId=NULL_ID, dwItemId=0
    const { handler, sent } = makeHandler({});
    handler.handleOpen(mockSocket(), new PacketReader(w.build()));
    assert.equal(sent.length, 1);
    assert.equal(subtype(sent[0]!), SNAPSHOTTYPE.BANKWINDOW);
    assert.equal(sent[0]!.readUInt32LE(16), 1, 'nMode = open');
  });

  it('handleClose sends no snapshot (bodyless ack)', () => {
    const { handler, sent } = makeHandler({});
    handler.handleClose(mockSocket(), new PacketReader(Buffer.alloc(1)));
    assert.equal(sent.length, 0);
  });
});

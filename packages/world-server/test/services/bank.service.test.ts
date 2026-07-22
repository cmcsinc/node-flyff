/**
 * BankService test -- account-shared bank item/gold deposit & withdraw.
 *
 * Deposit moves an item from the main bag into the first empty bank tab slot;
 * withdraw reverses it. Gold moves between `m_nGold` and `m_BankGold[0]`. Each
 * journals + persists before the handler acks.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CPlayer } from '../../src/entities/player.js';
import { BankService } from '../../src/services/bank.service.js';
import { BANK_SLOTS, MAX_BANK_TABS } from '../../src/net/snapshot/constants.js';
import type { CharacterRow } from '@flyff/database';

function makeRow(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 7, account_id: 42, name: 'Tester', slot: 0, class: 0, gender: 0,
    hair_style: 0, hair_color: 0, face_style: 0, skin_color: 0,
    level: 1, exp: 0n, hp: 200, mp: 100, max_hp: 200, max_mp: 100,
    strength: 15, stamina: 15, dexterity: 15, intelligence: 15,
    x: 0, y: 0, z: 0, world_id: 'flaris', zone_id: 1,
    created_at: new Date(), updated_at: new Date(), ...over,
  };
}

function makeSvc() {
  const journalCalls: Array<{ type: string }> = [];
  const bankSet: Array<{ tab: number; slot: number; itemId: number; qty: number }> = [];
  const bankRemove: Array<{ tab: number; slot: number }> = [];
  const goldSet: number[] = [];
  const invRemove: number[] = [];
  const invSet: Array<{ slot: number; itemId: number; qty: number }> = [];
  const passSet: string[] = [];
  const goldUpdates: number[] = [];
  const svc = new BankService({
    bankRepo: {
      setItem: async (_a: number, tab: number, slot: number, itemId: number, qty: number) => bankSet.push({ tab, slot, itemId, qty }),
      removeItem: async (_a: number, tab: number, slot: number) => bankRemove.push({ tab, slot }),
      getGold: async () => 0,
      setGold: async (_a: number, amount: number) => goldSet.push(amount),
    },
    inventoryRepo: {
      removeItem: async (_c: number, slot: number) => invRemove.push(slot),
      setItem: async (_c: number, slot: number, itemId: number, qty: number) => invSet.push({ slot, itemId, qty }),
    },
    characterRepo: {
      updateBankPass: async (_id: number, bankPass: string) => { passSet.push(bankPass); },
      updateGold: async (_id: number, gold: number) => { goldUpdates.push(gold); },
    },
    journal: { append: (e: { type: string }) => { journalCalls.push(e); } } as never,
  });
  return { svc, journalCalls, bankSet, bankRemove, goldSet, invRemove, invSet, passSet, goldUpdates };
}

describe('BankService.deposit', () => {
  it('moves the full stack from inv into the first empty bank slot + journals first', async () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[3] = { itemId: 2950, count: 5 };
    const { svc, journalCalls, bankSet, invRemove } = makeSvc();

    const r = svc.deposit(player, 0, 3, 5);

    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.tab, 0);
      assert.equal(r.bankSlot, 0);
      assert.equal(r.item.count, 5);
    }
    assert.equal(player.m_Inventory[3], null, 'inv slot cleared');
    assert.equal(player.m_Bank[0]![0]!.itemId, 2950, 'bank slot populated');
    assert.equal(journalCalls[0]!.type, 'BANK_DEPOSIT', 'journal before persist');
    assert.deepEqual(bankSet[0], { tab: 0, slot: 0, itemId: 2950, qty: 5 });
    assert.ok(player._dirty.has('m_Inventory'));
    // Microtask flush for fire-and-forget removeItem.
    await Promise.resolve();
    assert.equal(invRemove[0], 3, 'inv row removed');
  });

  it('partial deposit decrements the inv stack and persists the remainder', async () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[0] = { itemId: 2950, count: 10 };
    const { svc, invSet } = makeSvc();

    const r = svc.deposit(player, 1, 0, 4);

    assert.equal(r.ok, true);
    assert.equal(player.m_Inventory[0]!.count, 6, 'inv stack reduced');
    assert.equal(player.m_Bank[1]![0]!.count, 4, 'bank got the partial');
    await Promise.resolve();
    assert.deepEqual(invSet[0], { slot: 0, itemId: 2950, qty: 6 }, 'inv remainder persisted');
  });

  it('returns bank_full when the tab has no empty slot', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[0] = { itemId: 2950, count: 1 };
    for (let i = 0; i < BANK_SLOTS; i++) player.m_Bank[0]![i] = { itemId: 1, count: 1 };
    const { svc, bankSet } = makeSvc();
    const r = svc.deposit(player, 0, 0, 1);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'bank_full');
    assert.equal(bankSet.length, 0);
  });

  it('rejects an out-of-range tab or equip-range inv slot', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Inventory[0] = { itemId: 1, count: 1 };
    const { svc } = makeSvc();
    assert.equal(svc.deposit(player, MAX_BANK_TABS, 0, 1).ok, false, 'tab >= MAX_BANK_TABS');
    assert.equal(svc.deposit(player, 0, 50, 1).ok, false, 'inv slot outside main bag');
  });
});

describe('BankService.withdraw', () => {
  it('moves the stack from bank into the first empty inv slot', async () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_Bank[2]![5] = { itemId: 1234, count: 3 };
    const { svc, bankRemove } = makeSvc();

    const r = svc.withdraw(player, 2, 5, 3);

    assert.equal(r.ok, true);
    assert.equal(player.m_Bank[2]![5], null, 'bank slot cleared');
    assert.equal(player.m_Inventory[0]!.itemId, 1234, 'item now in inv slot 0');
    await Promise.resolve();
    assert.deepEqual(bankRemove[0], { tab: 2, slot: 5 });
  });

  it('returns bag_full when the main bag is full', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    for (let i = 0; i < 42; i++) player.m_Inventory[i] = { itemId: 1, count: 1 };
    player.m_Bank[0]![0] = { itemId: 1234, count: 1 };
    const { svc } = makeSvc();
    const r = svc.withdraw(player, 0, 0, 1);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'bag_full');
  });
});

describe('BankService gold', () => {
  it('depositGold moves penya from inv to bank tab 0 + persists both sides', async () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_nGold = 1000;
    const { svc, goldSet, goldUpdates, journalCalls } = makeSvc();
    const r = svc.depositGold(player, 400);
    assert.equal(r.ok, true);
    assert.equal(player.m_nGold, 600);
    assert.equal(player.m_BankGold[0], 400);
    assert.equal(journalCalls[0]!.type, 'CHAR_GOLD');
    assert.deepEqual((journalCalls[0] as { payload: { gold: number } }).payload, { gold: 600 });
    await Promise.resolve();
    assert.equal(goldSet[0], 400, 'bank gold persisted');
    assert.equal(goldUpdates[0], 600, 'inv gold persisted -- prevents relog dupe');
  });

  it('withdrawGold moves penya from bank to inv + persists both sides', async () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_nGold = 100;
    player.m_BankGold[0] = 500;
    const { svc, goldSet, goldUpdates } = makeSvc();
    const r = svc.withdrawGold(player, 200);
    assert.equal(r.ok, true);
    assert.equal(player.m_nGold, 300);
    assert.equal(player.m_BankGold[0], 300);
    await Promise.resolve();
    assert.equal(goldSet[0], 300, 'bank gold persisted');
    assert.equal(goldUpdates[0], 300, 'inv gold persisted');
  });

  it('withdrawGold rejects over-spend', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_BankGold[0] = 100;
    const { svc } = makeSvc();
    const r = svc.withdrawGold(player, 500);
    assert.equal(r.ok, false);
    assert.equal(player.m_BankGold[0], 100, 'unchanged on reject');
  });
});

describe('BankService.changeBankPass', () => {
  it('saves the new password + journals + persists when the old one matches', async () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_szBankPass = '1234';
    const { svc, journalCalls, passSet } = makeSvc();

    const r = svc.changeBankPass(player, '1234', '4321', 0xffffffff, 0);

    assert.equal(r.ok, true);
    assert.equal(player.m_szBankPass, '4321');
    assert.equal(journalCalls[0]!.type, 'BANK_PASS', 'journal before persist');
    assert.deepEqual((journalCalls[0] as { payload: { bankPass: string } }).payload, { bankPass: '4321' });
    await Promise.resolve();
    assert.equal(passSet[0], '4321', 'password persisted');
  });

  it('rejects (nMode=0) when the old password does not match', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_szBankPass = '1234';
    const { svc, journalCalls, passSet } = makeSvc();

    const r = svc.changeBankPass(player, 'wrong', '4321', 0xffffffff, 0);

    assert.equal(r.ok, false);
    assert.equal(player.m_szBankPass, '1234', 'password unchanged');
    assert.equal(journalCalls.length, 0, 'nothing journaled');
    assert.equal(passSet.length, 0, 'nothing persisted');
  });

  it('rejects a password longer than 4 chars (OnChangeBankPass:3965)', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_szBankPass = '1234';
    const { svc } = makeSvc();
    assert.equal(svc.changeBankPass(player, '1234', '12345', 0xffffffff, 0).ok, false, 'new too long');
    assert.equal(svc.changeBankPass(player, '12345', '9999', 0xffffffff, 0).ok, false, 'old too long');
    assert.equal(player.m_szBankPass, '1234', 'unchanged on over-length reject');
  });

  it('clears to the no-password sentinel when the new pass is empty', async () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_szBankPass = '1234';
    const { svc, passSet } = makeSvc();
    const r = svc.changeBankPass(player, '1234', '', 0xffffffff, 0);
    assert.equal(r.ok, true);
    assert.equal(player.m_szBankPass, '0000');
    await Promise.resolve();
    assert.equal(passSet[0], '0000');
  });
});

describe('BankService.confirmBankPass', () => {
  it('opens the bank when the password matches', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_szBankPass = '1234';
    const { svc } = makeSvc();
    const r = svc.confirmBankPass(player, '1234', 0xffffffff, 0);
    assert.equal(r.ok, true);
    assert.equal(player.m_bBankOpen, true);
  });

  it('re-prompts (nMode=0) and stays closed on a mismatch', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_szBankPass = '1234';
    const { svc } = makeSvc();
    const r = svc.confirmBankPass(player, 'wrong', 0xffffffff, 0);
    assert.equal(r.ok, false);
    assert.equal(player.m_bBankOpen, false);
  });

  it('accepts any password on a password-less bank (0000 sentinel)', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    const { svc } = makeSvc();
    const r = svc.confirmBankPass(player, '0000', 0xffffffff, 0);
    assert.equal(r.ok, true);
  });
});

describe('BankService.open', () => {
  it('returns nMode 0 (set-pin dialog) when no password is set', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    const { svc } = makeSvc();
    assert.equal(svc.open(player), 0);
    assert.equal(player.m_bBankOpen, true);
  });

  it('returns nMode 1 (enter-pin dialog) when a password is set', () => {
    const player = CPlayer.fromRow(makeRow({ bank_pass: '1234' }), { write: () => true });
    const { svc } = makeSvc();
    assert.equal(svc.open(player), 1);
  });
});

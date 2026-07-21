/**
 * BankService test — account-shared bank item/gold deposit & withdraw.
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
    journal: { append: (e: { type: string }) => { journalCalls.push(e); } } as never,
  });
  return { svc, journalCalls, bankSet, bankRemove, goldSet, invRemove, invSet };
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
  it('depositGold moves penya from inv to bank tab 0', async () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_nGold = 1000;
    const { svc, goldSet, journalCalls } = makeSvc();
    const r = svc.depositGold(player, 400);
    assert.equal(r.ok, true);
    assert.equal(player.m_nGold, 600);
    assert.equal(player.m_BankGold[0], 400);
    assert.equal(journalCalls[0]!.type, 'BANK_GOLD_IN');
    await Promise.resolve();
    assert.equal(goldSet[0], 400, 'bank gold persisted');
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

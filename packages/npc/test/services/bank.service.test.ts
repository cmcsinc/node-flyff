/**
 * BankService test -- account-shared bank item/gold deposit & withdraw.
 *
 * Deposit moves an item from the main bag into the first empty bank tab slot;
 * withdraw reverses it. Gold moves between `m_nGold` and `m_BankGold[0]`. Each
 * journals + persists before the handler acks.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CPlayer } from '@flyff/entities';
import { MAX_GOLD } from '@flyff/core';
import { BankService, type BankSpawnLookup } from '../../src/services/bank.service';
import { BANK_SLOTS, MAX_BANK_TABS, NULL_ID } from '@flyff/world-core';
import { MMI_BANKING } from '@flyff/resources';
import type { CharacterRow } from '@flyff/database';
import type { CMover } from '@flyff/entities';

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

/** Fake bank NPC at origin with MMI_BANKING. */
function makeBankNpc(x = 0, z = 0): Pick<CMover, 'm_abMoverMenu' | 'm_vPos'> {
  return { m_abMoverMenu: [MMI_BANKING], m_vPos: { x, y: 0, z } };
}

function makeSvc(spawnNpcs: ReadonlyArray<Pick<CMover, 'm_abMoverMenu' | 'm_vPos'>> = [makeBankNpc()]) {
  const journalCalls: Array<{ type: string }> = [];
  const bankSet: Array<{ tab: number; slot: number; itemId: number; qty: number }> = [];
  const bankRemove: Array<{ tab: number; slot: number }> = [];
  const goldSet: Array<{ tab: number; amount: number }> = [];
  const invRemove: number[] = [];
  const invSet: Array<{ slot: number; itemId: number; qty: number }> = [];
  const passSet: string[] = [];
  const invGold: number[] = [];
  const spawnManager: BankSpawnLookup = { inZone: () => spawnNpcs as readonly CMover[] };
  const svc = new BankService({
    bankRepo: {
      setItem: async (_a: number, tab: number, slot: number, itemId: number, qty: number) => bankSet.push({ tab, slot, itemId, qty }),
      removeItem: async (_a: number, tab: number, slot: number) => bankRemove.push({ tab, slot }),
      getGold: async () => 0,
      setGold: async (_a: number, amount: number, tab: number) => goldSet.push({ tab, amount }),
      getBankPass: async () => '0000',
      setBankPass: async (_a: number, bankPass: string) => { passSet.push(bankPass); },
    },
    inventoryRepo: {
      removeItem: async (_c: number, slot: number) => invRemove.push(slot),
      setItem: async (_c: number, slot: number, itemId: number, qty: number) => invSet.push({ slot, itemId, qty }),
      setGold: async (_c: number, gold: number) => { invGold.push(gold); },
    },
    spawnManager,
    journal: { append: (e: { type: string }) => { journalCalls.push(e); } } as never,
  });
  return { svc, journalCalls, bankSet, bankRemove, goldSet, invRemove, invSet, passSet, invGold };
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
    const { svc, goldSet, invGold, journalCalls } = makeSvc();
    const r = svc.depositGold(player, 0, 400);
    assert.equal(r.ok, true);
    assert.equal(player.m_nGold, 600);
    assert.equal(player.m_BankGold[0], 400);
    assert.equal(journalCalls[0]!.type, 'CHAR_GOLD');
    assert.deepEqual((journalCalls[0] as { payload: { gold: number } }).payload, { gold: 600 });
    await Promise.resolve();
    assert.deepEqual(goldSet[0], { tab: 0, amount: 400 }, 'bank gold persisted to tab 0');
    assert.equal(invGold[0], 600, 'inv gold persisted -- prevents relog dupe');
  });

  it('depositGold targets the per-tab pool (tab 1) without disturbing tab 0', async () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_nGold = 1000;
    player.m_BankGold[0] = 111;
    const { svc, goldSet } = makeSvc();
    const r = svc.depositGold(player, 1, 400);
    assert.equal(r.ok, true);
    assert.equal(player.m_nGold, 600);
    assert.equal(player.m_BankGold[1], 400, 'tab 1 received the deposit');
    assert.equal(player.m_BankGold[0], 111, 'tab 0 untouched');
    await Promise.resolve();
    assert.deepEqual(goldSet[0], { tab: 1, amount: 400 }, 'persisted to tab 1 column');
  });

  it('withdrawGold moves penya from bank to inv + persists both sides', async () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_nGold = 100;
    player.m_BankGold[0] = 500;
    const { svc, goldSet, invGold } = makeSvc();
    const r = svc.withdrawGold(player, 0, 200);
    assert.equal(r.ok, true);
    assert.equal(player.m_nGold, 300);
    assert.equal(player.m_BankGold[0], 300);
    await Promise.resolve();
    assert.deepEqual(goldSet[0], { tab: 0, amount: 300 }, 'bank gold persisted');
    assert.equal(invGold[0], 300, 'inv gold persisted');
  });

  it('withdrawGold rejects over-spend', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_BankGold[0] = 100;
    const { svc } = makeSvc();
    const r = svc.withdrawGold(player, 0, 500);
    assert.equal(r.ok, false);
    assert.equal(player.m_BankGold[0], 100, 'unchanged on reject');
  });

  it('rejects an out-of-range gold tab', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_nGold = 1000;
    const { svc, goldSet } = makeSvc();
    assert.equal(svc.depositGold(player, MAX_BANK_TABS, 10).ok, false, 'deposit tab >= MAX');
    assert.equal(svc.withdrawGold(player, -1, 10).ok, false, 'withdraw tab < 0');
    assert.equal(goldSet.length, 0, 'nothing persisted on reject');
  });

  // H16: depositGold rejects when no bank NPC is nearby.
  it('rejects depositGold when no bank NPC is within range', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_nGold = 1000;
    player.m_vPos = { x: 500, y: 0, z: 500 };
    const { svc, goldSet } = makeSvc([makeBankNpc(0, 0)]);
    const r = svc.depositGold(player, 0, 100);
    assert.equal(r.ok, false);
    assert.equal(goldSet.length, 0, 'nothing persisted on reject');
  });

  // M12: C++ DPSrvr.cpp:3929 -- bank gold overflow guard (CanAdd check).
  it('M12: rejects depositGold when bank tab gold would overflow MAX_GOLD', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_nGold = 500_000_000;
    player.m_BankGold[0] = 1_900_000_000;
    const { svc, goldSet } = makeSvc();
    const r = svc.depositGold(player, 0, 200_000_000);
    assert.equal(r.ok, false, 'rejects when bank gold + amount > MAX_GOLD');
    assert.equal(goldSet.length, 0, 'nothing persisted on reject');
  });

  it('M12: allows depositGold when bank tab gold stays within MAX_GOLD', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_nGold = 500_000_000;
    player.m_BankGold[0] = 1_800_000_000;
    const { svc } = makeSvc();
    const r = svc.depositGold(player, 0, 200_000_000);
    assert.equal(r.ok, true, '2B total does not overflow MAX_GOLD (2B)');
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
    assert.deepEqual((journalCalls[0] as { payload: { accountId: number; bankPass: string } }).payload, { accountId: 42, bankPass: '4321' });
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
    // NPC click (dwId != NULL_ID) skips proximity check.
    assert.equal(svc.open(player, 42), 0);
    assert.equal(player.m_bBankOpen, true);
  });

  it('returns nMode 1 (enter-pin dialog) when a password is set', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_szBankPass = '1234';
    const { svc } = makeSvc();
    assert.equal(svc.open(player, 42), 1);
  });

  // H14: proximity check when opening bank directly (dwId == NULL_ID).
  it('allows direct open (NULL_ID) when a bank NPC is within range', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_vPos = { x: 5, y: 0, z: 5 };
    const { svc } = makeSvc([makeBankNpc(0, 0)]);
    assert.equal(svc.open(player, NULL_ID), 0);
    assert.equal(player.m_bBankOpen, true);
  });

  it('rejects direct open (NULL_ID) when no bank NPC is nearby', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_vPos = { x: 200, y: 0, z: 200 };
    const { svc } = makeSvc([makeBankNpc(0, 0)]);
    assert.equal(svc.open(player, NULL_ID), -1);
    assert.equal(player.m_bBankOpen, false);
  });

  it('skips proximity check when dwId != NULL_ID (NPC click)', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_vPos = { x: 999, y: 0, z: 999 };
    // No bank NPCs at all -- still allowed because dwId is set.
    const { svc } = makeSvc([]);
    assert.equal(svc.open(player, 100), 0);
  });

  // H15: chaotic players cannot open the bank.
  it('rejects chaotic players (PK propensity > 0)', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_dwPKPropensity = 1;
    const { svc } = makeSvc();
    assert.equal(svc.open(player, 42), -1);
    assert.equal(player.m_bBankOpen, false);
  });

  it('allows non-chaotic players (PK propensity == 0)', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_dwPKPropensity = 0;
    const { svc } = makeSvc();
    assert.equal(svc.open(player, 42), 0);
  });
});

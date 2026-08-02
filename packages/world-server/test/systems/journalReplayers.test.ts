/**
 * registerReplayers -- the replay handlers must call the right repo method with
 * the parsed ABSOLUTE payload, and be idempotent (re-applying is harmless).
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { Journal } from '@flyff/database';
import { JournalReplayer } from '../../src/systems/journalReplayer';
import { registerReplayers } from '../../src/systems/journalReplayers';

interface ExpCall { id: number; level: number; exp: bigint; }
interface GoldCall { id: number; gold: number; }
interface SlotCall { id: number; slot: number; itemId?: number; count?: number; op: 'set' | 'remove'; }
interface PassCall { accountId: number; bankPass: string; }
interface SkillRosterCall { id: number; roster: Array<{ slot: number; skillId: number; level: number }>; }
interface SkillPointCall { id: number; skillPoint: number; skillLevel: number; }
interface BankSlotCall { accountId: number; tab: number; slot: number; itemId?: number; count?: number; op: 'set' | 'remove'; }
interface BankGoldCall { accountId: number; tab: number; gold: number; }
interface PkCall { id: number; prop: number; value: number; time: number; }

function makeRepos() {
  const expCalls: ExpCall[] = [];
  const goldCalls: GoldCall[] = [];
  const slotCalls: SlotCall[] = [];
  const passCalls: PassCall[] = [];
  const skillRosterCalls: SkillRosterCall[] = [];
  const skillPointCalls: SkillPointCall[] = [];
  const bankSlotCalls: BankSlotCall[] = [];
  const bankGoldCalls: BankGoldCall[] = [];
  const pkCalls: PkCall[] = [];
  const logs: string[] = [];
  return {
    expCalls, goldCalls, slotCalls, passCalls, skillRosterCalls, skillPointCalls, logs,
    bankSlotCalls, bankGoldCalls, pkCalls,
    charRepo: {
      updateLevelAndExp: async (id: number, level: number, exp: bigint) => {
        expCalls.push({ id, level, exp });
      },
      updateSkillPoints: async (id: number, skillPoint: number, skillLevel: number) => {
        skillPointCalls.push({ id, skillPoint, skillLevel });
      },
      updatePKState: async (id: number, prop: number, value: number, time: number) => {
        pkCalls.push({ id, prop, value, time });
      },
      updateStats: async () => {},
      updateClass: async () => {},
    },
    inventoryRepo: {
      setItem: async (id: number, slot: number, itemId: number, count: number) => {
        slotCalls.push({ id, slot, itemId, count, op: 'set' });
      },
      removeItem: async (id: number, slot: number) => {
        slotCalls.push({ id, slot, op: 'remove' });
      },
      setGold: async (id: number, gold: number) => {
        goldCalls.push({ id, gold });
      },
    },
    bankRepo: {
      setBankPass: async (accountId: number, bankPass: string) => {
        passCalls.push({ accountId, bankPass });
      },
      setItem: async (accountId: number, tab: number, slot: number, itemId: number, count: number) => {
        bankSlotCalls.push({ accountId, tab, slot, itemId, count, op: 'set' });
      },
      removeItem: async (accountId: number, tab: number, slot: number) => {
        bankSlotCalls.push({ accountId, tab, slot, op: 'remove' });
      },
      setGold: async (accountId: number, gold: number, tab: number) => {
        bankGoldCalls.push({ accountId, tab, gold });
      },
    },
    skillRepo: {
      saveAll: async (id: number, roster: Array<{ slot: number; skillId: number; level: number }>) => {
        skillRosterCalls.push({ id, roster });
      },
    },
    logger: {
      info: () => {}, warn: () => {}, error: () => {},
      debug: () => { logs.push('debug'); }, trace: () => {}, fatal: () => {},
      child: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {} }),
    },
  };
}

describe('registerReplayers', () => {
  it('CHAR_EXP replays level + BigInt exp (idempotent across rows)', async () => {
    const journal = new Journal({ path: ':memory:' });
    const r = new JournalReplayer({ journal, logger: makeRepos().logger as never });
    const repos = makeRepos();
    registerReplayers(r, { charRepo: repos.charRepo as never, inventoryRepo: repos.inventoryRepo as never, bankRepo: repos.bankRepo as never, skillRepo: repos.skillRepo as never, logger: repos.logger as never });

    // Two absolute exp snapshots for char 7 -- replay applies both in order;
    // final DB write is the later one, no dupe (additive deltas would dup).
    journal.append({ charId: 7, type: 'CHAR_EXP', payload: { level: 5, exp: '100' } });
    journal.append({ charId: 7, type: 'CHAR_EXP', payload: { level: 5, exp: '250' } });

    await r.recover();
    assert.deepEqual(repos.expCalls, [
      { id: 7, level: 5, exp: 100n },
      { id: 7, level: 5, exp: 250n },
    ]);
    journal.close();
  });

  it('CHAR_GOLD replays the absolute gold total', async () => {
    const journal = new Journal({ path: ':memory:' });
    const repos = makeRepos();
    const r = new JournalReplayer({ journal, logger: repos.logger as never });
    registerReplayers(r, { charRepo: repos.charRepo as never, inventoryRepo: repos.inventoryRepo as never, bankRepo: repos.bankRepo as never, skillRepo: repos.skillRepo as never, logger: repos.logger as never });

    journal.append({ charId: 3, type: 'CHAR_GOLD', payload: { gold: 999 } });
    await r.recover();
    assert.deepEqual(repos.goldCalls, [{ id: 3, gold: 999 }]);
    journal.close();
  });

  it('BANK_PASS replays the account-wide pin via bankRepo', async () => {
    const journal = new Journal({ path: ':memory:' });
    const repos = makeRepos();
    const r = new JournalReplayer({ journal, logger: repos.logger as never });
    registerReplayers(r, { charRepo: repos.charRepo as never, inventoryRepo: repos.inventoryRepo as never, bankRepo: repos.bankRepo as never, skillRepo: repos.skillRepo as never, logger: repos.logger as never });

    journal.append({ charId: 3, type: 'BANK_PASS', payload: { accountId: 42, bankPass: '4321' } });
    await r.recover();
    assert.deepEqual(repos.passCalls, [{ accountId: 42, bankPass: '4321' }]);
    journal.close();
  });

  it('INVENTORY_SLOT set vs remove (itemId===0 => removeItem)', async () => {
    const journal = new Journal({ path: ':memory:' });
    const repos = makeRepos();
    const r = new JournalReplayer({ journal, logger: repos.logger as never });
    registerReplayers(r, { charRepo: repos.charRepo as never, inventoryRepo: repos.inventoryRepo as never, bankRepo: repos.bankRepo as never, skillRepo: repos.skillRepo as never, logger: repos.logger as never });

    journal.append({ charId: 9, type: 'INVENTORY_SLOT', payload: { slot: 4, itemId: 6005, count: 3 } });
    journal.append({ charId: 9, type: 'INVENTORY_SLOT', payload: { slot: 4, itemId: 0, count: 0 } });

    await r.recover();
    assert.deepEqual(repos.slotCalls, [
      { id: 9, slot: 4, itemId: 6005, count: 3, op: 'set' },
      { id: 9, slot: 4, op: 'remove' },
    ]);
    journal.close();
  });

  it('keeps BigInt precision through JSON string round-trip', async () => {
    const journal = new Journal({ path: ':memory:' });
    const repos = makeRepos();
    const r = new JournalReplayer({ journal, logger: repos.logger as never });
    registerReplayers(r, { charRepo: repos.charRepo as never, inventoryRepo: repos.inventoryRepo as never, bankRepo: repos.bankRepo as never, skillRepo: repos.skillRepo as never, logger: repos.logger as never });

    // Value > 2^32 but < 2^53 -- must survive Number->String->BigInt.
    const big = '9007199254740991'; // Number.MAX_SAFE_INTEGER
    journal.append({ charId: 1, type: 'CHAR_EXP', payload: { level: 120, exp: big } });
    await r.recover();
    assert.equal(repos.expCalls[0]!.exp, 9007199254740991n);
    journal.close();
  });

  it('SKILL_LEARN replays absolute roster via saveAll + SP via updateSkillPoints', async () => {
    const journal = new Journal({ path: ':memory:' });
    const repos = makeRepos();
    const r = new JournalReplayer({ journal, logger: repos.logger as never });
    registerReplayers(r, { charRepo: repos.charRepo as never, inventoryRepo: repos.inventoryRepo as never, bankRepo: repos.bankRepo as never, skillRepo: repos.skillRepo as never, logger: repos.logger as never });

    // Two absolute roster snapshots for char 5 -- replay applies both in order;
    // final DB state is the later one (saveAll delete+reinserts), no dupe.
    journal.append({ charId: 5, type: 'SKILL_LEARN', payload: { roster: [{ slot: 0, skillId: 1, level: 1 }], skillPoint: 9, skillLevel: 2 } });
    journal.append({ charId: 5, type: 'SKILL_LEARN', payload: { roster: [{ slot: 0, skillId: 1, level: 3 }], skillPoint: 5, skillLevel: 2 } });

    await r.recover();
    assert.deepEqual(repos.skillRosterCalls, [
      { id: 5, roster: [{ slot: 0, skillId: 1, level: 1 }] },
      { id: 5, roster: [{ slot: 0, skillId: 1, level: 3 }] },
    ]);
    assert.deepEqual(repos.skillPointCalls, [
      { id: 5, skillPoint: 9, skillLevel: 2 },
      { id: 5, skillPoint: 5, skillLevel: 2 },
    ]);
    journal.close();
  });

  it('BANK_SLOT set vs remove (itemId===0 => removeItem) and is idempotent', async () => {
    const journal = new Journal({ path: ':memory:' });
    const repos = makeRepos();
    const r = new JournalReplayer({ journal, logger: repos.logger as never });
    registerReplayers(r, { charRepo: repos.charRepo as never, inventoryRepo: repos.inventoryRepo as never, bankRepo: repos.bankRepo as never, skillRepo: repos.skillRepo as never, logger: repos.logger as never });

    journal.append({ charId: 7, type: 'BANK_SLOT', payload: { accountId: 42, tab: 1, slot: 3, itemId: 2950, count: 5 } });
    journal.append({ charId: 7, type: 'BANK_SLOT', payload: { accountId: 42, tab: 1, slot: 3, itemId: 0, count: 0 } });

    await r.recover();
    assert.deepEqual(repos.bankSlotCalls, [
      { accountId: 42, tab: 1, slot: 3, itemId: 2950, count: 5, op: 'set' },
      { accountId: 42, tab: 1, slot: 3, op: 'remove' },
    ]);
    journal.close();
  });

  it('BANK_GOLD replays the absolute per-tab pool (tab is the 3rd setGold arg)', async () => {
    const journal = new Journal({ path: ':memory:' });
    const repos = makeRepos();
    const r = new JournalReplayer({ journal, logger: repos.logger as never });
    registerReplayers(r, { charRepo: repos.charRepo as never, inventoryRepo: repos.inventoryRepo as never, bankRepo: repos.bankRepo as never, skillRepo: repos.skillRepo as never, logger: repos.logger as never });

    journal.append({ charId: 7, type: 'BANK_GOLD', payload: { accountId: 42, tab: 2, gold: 1234 } });
    await r.recover();
    assert.deepEqual(repos.bankGoldCalls, [{ accountId: 42, tab: 2, gold: 1234 }]);
    journal.close();
  });

  it('PK_KILL replays the killer absolute PK state', async () => {
    const journal = new Journal({ path: ':memory:' });
    const repos = makeRepos();
    const r = new JournalReplayer({ journal, logger: repos.logger as never });
    registerReplayers(r, { charRepo: repos.charRepo as never, inventoryRepo: repos.inventoryRepo as never, bankRepo: repos.bankRepo as never, skillRepo: repos.skillRepo as never, logger: repos.logger as never });

    journal.append({ charId: 9, type: 'PK_KILL', payload: { pkPropensity: 1, pkValue: 3, pkTime: 1700, victimId: 4 } });
    await r.recover();
    assert.deepEqual(repos.pkCalls, [{ id: 9, prop: 1, value: 3, time: 1700 }]);
    journal.close();
  });

  it('every type a service emits has a registered replayer (zero skipped)', async () => {
    const journal = new Journal({ path: ':memory:' });
    const repos = makeRepos();
    const r = new JournalReplayer({ journal, logger: repos.logger as never });
    registerReplayers(r, { charRepo: repos.charRepo as never, inventoryRepo: repos.inventoryRepo as never, bankRepo: repos.bankRepo as never, skillRepo: repos.skillRepo as never, logger: repos.logger as never });

    // Keep this list in sync with `grep -rho "type: '[A-Z_]\+'" packages/*/src`.
    const emitted = [
      { type: 'CHAR_EXP', payload: { level: 1, exp: '0' } },
      { type: 'CHAR_GOLD', payload: { gold: 0 } },
      { type: 'INVENTORY_SLOT', payload: { slot: 0, itemId: 0, count: 0 } },
      { type: 'BANK_PASS', payload: { accountId: 1, bankPass: '0000' } },
      { type: 'CHAR_STATS', payload: { strength: 15, stamina: 15, dexterity: 15, intelligence: 15, remain_gp: 0 } },
      { type: 'SKILL_LEARN', payload: { roster: [], skillPoint: 0, skillLevel: 0 } },
      { type: 'CHAR_JOB', payload: { class: 1, roster: [] } },
      { type: 'BANK_SLOT', payload: { accountId: 1, tab: 0, slot: 0, itemId: 0, count: 0 } },
      { type: 'BANK_GOLD', payload: { accountId: 1, tab: 0, gold: 0 } },
      { type: 'PK_KILL', payload: { pkPropensity: 0, pkValue: 0, pkTime: 0 } },
    ];
    for (const e of emitted) journal.append({ charId: 1, type: e.type, payload: e.payload });

    const summary = await r.recover();
    assert.equal(summary.skipped, 0, 'an emitted type has no replayer');
    assert.equal(summary.replayed, emitted.length);
    journal.close();
  });
});

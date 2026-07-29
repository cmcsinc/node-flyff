import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { MODE } from '@flyff/entities';
import type { MailRow } from '@flyff/database';
import { MailService } from '../../src/services/mail.service';

/** Minimal CPlayer stand-in -- the service only touches these fields. */
function makePlayer(charId = 1): { m_idPlayer: number; m_dwMode: number } {
  return { m_idPlayer: charId, m_dwMode: 0 };
}

function makeRow(over: Partial<MailRow> = {}): MailRow {
  return {
    id: 10,
    receiver_id: 1,
    sender_id: 0,
    sender_name: 'FLYFF',
    title: 'gift',
    text: 'enjoy',
    gold: '0',
    item_id: null,
    item_count: 0,
    item_flags: 0,
    item_refine: 0,
    item_element: 0,
    item_element_level: 0,
    item_durability: -1,
    read: false,
    taken_item: false,
    taken_gold: false,
    created_at_ms: Date.now(),
    ...over,
  };
}

/** Records which repo mutators fired so the "row survives a claim" rule is testable. */
interface RepoCalls {
  markRead: number[];
  markTakenItem: number[];
  markTakenGold: number[];
  remove: number[];
}

function makeRepo(rows: MailRow[], pending = 0) {
  const calls: RepoCalls = { markRead: [], markTakenItem: [], markTakenGold: [], remove: [] };
  const repo = {
    calls,
    async listByReceiver(receiverId: number) {
      return rows.filter((r) => r.receiver_id === receiverId);
    },
    async findById(id: number) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async markRead(id: number) { calls.markRead.push(id); },
    async markTakenItem(id: number) { calls.markTakenItem.push(id); },
    async markTakenGold(id: number) { calls.markTakenGold.push(id); },
    async remove(id: number) { calls.remove.push(id); },
    async countPending() { return pending; },
    async create() { return 1; },
  };
  return repo;
}

function makeInventory(addOk = true) {
  const added: Array<{ itemId: number; count: number }> = [];
  const gold: number[] = [];
  return {
    added,
    gold,
    addItem(_p: unknown, itemId: number, count: number) {
      if (!addOk) return { ok: false as const, reason: 'bag_full' as const };
      added.push({ itemId, count });
      return {
        ok: true as const,
        changes: [{ slot: 0, objid: 0, itemId, count, isNew: true }],
      };
    },
    addGold(_p: unknown, amount: number) { gold.push(amount); },
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any -- structural test doubles */
function svc(repo: any, inv: any): MailService {
  return new MailService({ mailRepo: repo, inventoryService: inv });
}

describe('MailService', () => {
  let player: { m_idPlayer: number; m_dwMode: number };
  beforeEach(() => { player = makePlayer(); });

  describe('listForPlayer', () => {
    it('derives the wire age from created_at_ms', async () => {
      const rows = [makeRow({ created_at_ms: Date.now() - 120_000 })];
      const out = await svc(makeRepo(rows), makeInventory()).listForPlayer(1);
      assert.equal(out.length, 1);
      assert.ok(out[0]!.ageSecs >= 119 && out[0]!.ageSecs <= 121, `age was ${out[0]!.ageSecs}`);
    });

    it('hides an attachment once it has been taken', async () => {
      const rows = [makeRow({ item_id: 500, item_count: 2, taken_item: true, gold: '900', taken_gold: true })];
      const out = await svc(makeRepo(rows), makeInventory()).listForPlayer(1);
      assert.equal(out[0]!.item, null, 'claimed item must not re-render');
      assert.equal(out[0]!.gold, 0, 'claimed penya must not re-render');
    });

    it('surfaces an unclaimed attachment', async () => {
      const rows = [makeRow({ item_id: 500, item_count: 2, item_refine: 3, gold: '900' })];
      const out = await svc(makeRepo(rows), makeInventory()).listForPlayer(1);
      assert.deepEqual(out[0]!.item, {
        itemId: 500, count: 2, flags: 0, refine: 3, durability: -1, element: 0, element_level: 0,
      });
      assert.equal(out[0]!.gold, 900);
    });
  });

  describe('takeItem', () => {
    it('credits the bag and flags taken_item WITHOUT deleting the row', async () => {
      const repo = makeRepo([makeRow({ item_id: 42, item_count: 5 })]);
      const inv = makeInventory();
      const res = await svc(repo, inv).takeItem(player as never, 10);
      assert.equal(res.ok, true);
      assert.deepEqual(inv.added, [{ itemId: 42, count: 5 }]);
      assert.deepEqual(repo.calls.markTakenItem, [10]);
      assert.deepEqual(repo.calls.remove, [], 'C++ keeps the mail until QUERYREMOVEMAIL');
    });

    it('rejects on a full bag and leaves the mail untouched', async () => {
      const repo = makeRepo([makeRow({ item_id: 42, item_count: 5 })]);
      const res = await svc(repo, makeInventory(false)).takeItem(player as never, 10);
      assert.deepEqual(res, { ok: false, reason: 'bag_full' });
      assert.deepEqual(repo.calls.markTakenItem, [], 'a failed add must not consume the attachment');
    });

    it('rejects a second claim', async () => {
      const repo = makeRepo([makeRow({ item_id: 42, item_count: 5, taken_item: true })]);
      const inv = makeInventory();
      const res = await svc(repo, inv).takeItem(player as never, 10);
      assert.deepEqual(res, { ok: false, reason: 'already_taken' });
      assert.deepEqual(inv.added, []);
    });

    it('rejects a mail with no attachment', async () => {
      const res = await svc(makeRepo([makeRow()]), makeInventory()).takeItem(player as never, 10);
      assert.deepEqual(res, { ok: false, reason: 'no_item' });
    });

    it("refuses another player's mail", async () => {
      const repo = makeRepo([makeRow({ receiver_id: 99, item_id: 42, item_count: 1 })]);
      const inv = makeInventory();
      const res = await svc(repo, inv).takeItem(player as never, 10);
      assert.deepEqual(res, { ok: false, reason: 'not_found' });
      assert.deepEqual(inv.added, [], 'no cross-account item grant');
    });
  });

  describe('takeGold', () => {
    it('credits penya and flags taken_gold without deleting', async () => {
      const repo = makeRepo([makeRow({ gold: '250000' })]);
      const inv = makeInventory();
      const res = await svc(repo, inv).takeGold(player as never, 10);
      assert.equal(res.ok, true);
      assert.deepEqual(inv.gold, [250_000]);
      assert.deepEqual(repo.calls.markTakenGold, [10]);
      assert.deepEqual(repo.calls.remove, []);
    });

    it('rejects a zero-penya mail', async () => {
      const res = await svc(makeRepo([makeRow({ gold: '0' })]), makeInventory()).takeGold(player as never, 10);
      assert.deepEqual(res, { ok: false, reason: 'no_gold' });
    });

    it('rejects a second claim', async () => {
      const repo = makeRepo([makeRow({ gold: '500', taken_gold: true })]);
      const inv = makeInventory();
      assert.deepEqual(await svc(repo, inv).takeGold(player as never, 10), { ok: false, reason: 'already_taken' });
      assert.deepEqual(inv.gold, []);
    });
  });

  describe('markRead / remove', () => {
    it('marks read once and is idempotent on an already-read mail', async () => {
      const repo = makeRepo([makeRow({ read: true })]);
      const res = await svc(repo, makeInventory()).markRead(player as never, 10);
      assert.equal(res.ok, true);
      assert.deepEqual(repo.calls.markRead, [], 'no redundant write');
    });

    it('deletes on remove', async () => {
      const repo = makeRepo([makeRow()]);
      assert.equal((await svc(repo, makeInventory()).remove(player as never, 10)).ok, true);
      assert.deepEqual(repo.calls.remove, [10]);
    });
  });

  describe('syncMailboxMode', () => {
    it('sets MODE_MAILBOX when mail is pending and reports the new mode', async () => {
      const mode = await svc(makeRepo([], 2), makeInventory()).syncMailboxMode(player as never);
      assert.equal(mode, MODE.MAILBOX);
      assert.equal(player.m_dwMode & MODE.MAILBOX, MODE.MAILBOX);
    });

    it('clears MODE_MAILBOX when nothing is pending', async () => {
      player.m_dwMode = MODE.MAILBOX | MODE.TRANSPARENT;
      const mode = await svc(makeRepo([], 0), makeInventory()).syncMailboxMode(player as never);
      assert.equal(mode, MODE.TRANSPARENT, 'other mode bits survive');
      assert.equal(player.m_dwMode & MODE.MAILBOX, 0);
    });

    it('returns null when the bit already matches, so no MODIFYMODE is broadcast', async () => {
      assert.equal(await svc(makeRepo([], 0), makeInventory()).syncMailboxMode(player as never), null);
      player.m_dwMode = MODE.MAILBOX;
      assert.equal(await svc(makeRepo([], 3), makeInventory()).syncMailboxMode(player as never), null);
    });
  });

  it('maps each claim kind to the REMOVEMAIL nType C++ acks with', () => {
    assert.equal(MailService.ackType('delete'), 0);
    assert.equal(MailService.ackType('item'), 1);
    assert.equal(MailService.ackType('gold'), 2);
    assert.equal(MailService.ackType('read'), 3);
  });
});

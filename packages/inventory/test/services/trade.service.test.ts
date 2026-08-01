/**
 * TradeService tests -- the CVTInfo state machine.
 *
 * Priority is the two dupe surfaces called out in the service doc: stakes are
 * re-validated against the live bag at commit (items are NOT escrowed), and
 * staged gold IS debited immediately so every abort path must refund it.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CPlayer, VTInfo, TRADE_STEP, MAX_TRADE } from '@flyff/entities';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { NULL_ID } from '@flyff/world-core';
import { TradeService } from '../../src/services/trade.service';

interface Frame { readonly to: number; readonly buf: Buffer }
interface Ctx {
  svc: TradeService;
  sent: Frame[];
  journal: { type: string; charId: number; payload: unknown }[];
  repo: { calls: string[] };
}

function makePlayer(charId: number, gold = 0): CPlayer {
  const p = Object.create(CPlayer.prototype) as CPlayer & {
    m_Inventory: unknown[]; m_vtInfo: unknown; _dirty: Set<string>;
  };
  p.m_idPlayer = charId;
  p.m_szName = `P${charId}`;
  p.m_nGold = gold;
  p.m_nDuel = 0;
  p.m_tmLastDamage = 0;
  p.m_nZoneId = 1;
  p.m_vPos = { x: 0, y: 0, z: 0 };
  p.m_Inventory = new Array(73).fill(undefined);
  // m_vtInfo / _dirty are readonly class fields -- define them the way the
  // real constructor would, since we bypass it via Object.create.
  Object.defineProperty(p, 'm_vtInfo', { value: new VTInfo(), writable: false });
  Object.defineProperty(p, '_dirty', { value: new Set<string>(), writable: false });
  return p as unknown as CPlayer;
}

function makeCtx(players: readonly CPlayer[]): Ctx {
  const sent: Frame[] = [];
  const journal: { type: string; charId: number; payload: unknown }[] = [];
  const calls: string[] = [];
  const playerManager = {
    get: (id: number) => players.find((p) => p.m_idPlayer === id),
    sendTo: (p: CPlayer, buf: Buffer) => { sent.push({ to: p.m_idPlayer, buf }); },
  } as unknown as ConstructorParameters<typeof TradeService>[0]['playerManager'];
  const inventoryRepo = {
    setItem: async (...a: unknown[]) => { calls.push(`setItem:${a[0]}:${a[1]}`); },
    removeItem: async (c: number, s: number) => { calls.push(`removeItem:${c}:${s}`); },
    setGold: async (c: number, g: number) => { calls.push(`setGold:${c}:${g}`); },
  } as unknown as ConstructorParameters<typeof TradeService>[0]['inventoryRepo'];
  const svc = new TradeService({
    playerManager, inventoryRepo,
    journal: { append: (e: { charId: number; type: string; payload: unknown }) => {
      journal.push(e);
    } } as unknown as ConstructorParameters<typeof TradeService>[0]['journal'],
  });
  return { svc, sent, journal, repo: { calls } };
}

function open(buf: Buffer): { objid: number; subtype: number; r: PacketReader } {
  const r = new PacketReader(buf);
  assert.equal(r.readDword(), PACKETTYPE.SNAPSHOT);
  r.readDword();
  assert.equal(r.readWord(), 1);
  const objid = r.readDword();
  const subtype = r.readWord();
  return { objid, subtype, r };
}

const subtypes = (fs: readonly Frame[]): number[] => fs.map((f) => open(f.buf).subtype);
const item = (itemId: number, count: number, objid: number) => ({ itemId, count, objid });

/** Put both players into an open trade at step ITEM. */
function openTrade(ctx: Ctx, a: CPlayer, b: CPlayer): void {
  assert.deepEqual(ctx.svc.trade(a, b.m_idPlayer), { ok: true });
  ctx.sent.length = 0;
}

/** Drive both sides through OK -> confirm -> confirm (the full commit). */
function runCommit(ctx: Ctx, a: CPlayer, b: CPlayer): void {
  ctx.svc.ok(a);
  ctx.svc.ok(b);
  ctx.svc.lastConfirm(a);
  ctx.svc.lastConfirm(b);
}

describe('TradeService', () => {
  describe('opening', () => {
    it('CONFIRMTRADE pops the popup on the target with the requester objid', () => {
      const a = makePlayer(1); const b = makePlayer(2);
      const ctx = makeCtx([a, b]);
      assert.deepEqual(ctx.svc.confirmTrade(a, 2), { ok: true });
      assert.equal(ctx.sent.length, 1);
      assert.equal(ctx.sent[0]!.to, 2);
      const { objid, subtype, r } = open(ctx.sent[0]!.buf);
      assert.equal(subtype, SNAPSHOTTYPE.CONFIRMTRADE);
      assert.equal(objid, 1);          // requester, not target
      assert.equal(r.remaining, 0);    // bodyless
      // No state claimed by the popup.
      assert.equal(a.m_vtInfo.busy, false);
      assert.equal(b.m_vtInfo.busy, false);
    });

    it('refuses self, missing target, busy either side, and duel', () => {
      const a = makePlayer(1); const b = makePlayer(2); const c = makePlayer(3);
      const ctx = makeCtx([a, b, c]);

      assert.equal(ctx.svc.confirmTrade(a, 1).ok, false);        // self
      assert.equal(ctx.svc.confirmTrade(a, 999).ok, false);      // missing

      b.m_vtInfo.otherId = 3;                                     // target busy
      assert.deepEqual(ctx.svc.confirmTrade(a, 2), { ok: false, reason: 'target-busy' });
      b.m_vtInfo.otherId = null;

      a.m_vtInfo.otherId = 3;                                     // self busy
      assert.deepEqual(ctx.svc.confirmTrade(a, 2), { ok: false, reason: 'busy' });
      a.m_vtInfo.otherId = null;

      a.m_nDuel = 1;
      assert.deepEqual(ctx.svc.confirmTrade(a, 2), { ok: false, reason: 'duel' });
    });

    it('refuses a target damaged within the last 10s (IsAttackMode)', () => {
      const a = makePlayer(1); const b = makePlayer(2);
      const ctx = makeCtx([a, b]);
      const now = 1_000_000;
      b.m_tmLastDamage = now - 5_000;
      assert.deepEqual(ctx.svc.confirmTrade(a, 2, now), { ok: false, reason: 'target-in-combat' });
      b.m_tmLastDamage = now - 11_000;                            // window elapsed
      assert.deepEqual(ctx.svc.confirmTrade(a, 2, now), { ok: true });
    });

    it('TRADE links both sides and sends each the OTHER inventory', () => {
      const a = makePlayer(1); const b = makePlayer(2);
      a.m_Inventory[0] = item(111, 1, 0);
      b.m_Inventory[0] = item(222, 1, 0);
      const ctx = makeCtx([a, b]);

      assert.deepEqual(ctx.svc.trade(a, 2), { ok: true });
      assert.equal(a.m_vtInfo.otherId, 2);
      assert.equal(b.m_vtInfo.otherId, 1);
      assert.equal(a.m_vtInfo.state, TRADE_STEP.ITEM);

      assert.equal(ctx.sent.length, 2);
      const toA = open(ctx.sent.find((f) => f.to === 1)!.buf);
      const toB = open(ctx.sent.find((f) => f.to === 2)!.buf);
      assert.equal(toA.subtype, SNAPSHOTTYPE.TRADE_SNAPSHOT);
      assert.equal(toA.objid, 2);                 // A's copy carries B's objid
      assert.equal(toB.objid, 1);                 // and vice versa
      // uidPlayer is the INITIATOR in both copies.
      assert.equal(toA.r.readDword(), 1);
      assert.equal(toB.r.readDword(), 1);
    });
  });

  describe('staging', () => {
    it('clamps the staged count to the live slot and echoes the clamped value', () => {
      const a = makePlayer(1); const b = makePlayer(2);
      a.m_Inventory[3] = item(111, 5, 3);
      const ctx = makeCtx([a, b]);
      openTrade(ctx, a, b);

      assert.deepEqual(ctx.svc.put(a, 0, 0, 3, 99), { ok: true });
      assert.equal(a.m_vtInfo.items[0]!.count, 5);           // clamped, not 99
      // Item still in the bag -- no escrow.
      assert.equal(a.m_Inventory[3]!.count, 5);

      assert.equal(ctx.sent.length, 2);                       // both sides
      const { objid, subtype, r } = open(ctx.sent[0]!.buf);
      assert.equal(subtype, SNAPSHOTTYPE.TRADEPUT);
      assert.equal(objid, 1);                                 // the actor
      assert.equal(r.readByte(), 0);                          // window index
      r.readByte();                                           // itemType
      assert.equal(r.readByte(), 3);                          // bag slot
      assert.equal(r.readWord(), 5);                          // CLAMPED count
    });

    it('rejects out-of-range window index, bad count, and double-stake', () => {
      const a = makePlayer(1); const b = makePlayer(2);
      a.m_Inventory[0] = item(111, 2, 0);
      const ctx = makeCtx([a, b]);
      openTrade(ctx, a, b);

      assert.deepEqual(ctx.svc.put(a, MAX_TRADE, 0, 0, 1), { ok: false, reason: 'bad-index' });
      assert.deepEqual(ctx.svc.put(a, 0, 0, 0, 0), { ok: false, reason: 'bad-count' });
      assert.equal(ctx.svc.put(a, 0, 0, 0, 1).ok, true);
      // Same bag slot into a second window index -> refused.
      assert.equal(ctx.svc.put(a, 1, 0, 0, 1).ok, false);
      // Occupied window index -> refused.
      assert.equal(ctx.svc.put(a, 0, 0, 0, 1).ok, false);
    });

    it('sends TRADEPUTERROR (self only) when a put arrives past step ITEM', () => {
      const a = makePlayer(1); const b = makePlayer(2);
      a.m_Inventory[0] = item(111, 1, 0);
      const ctx = makeCtx([a, b]);
      openTrade(ctx, a, b);
      ctx.svc.ok(a);
      ctx.sent.length = 0;

      assert.deepEqual(ctx.svc.put(a, 0, 0, 0, 1), { ok: false, reason: 'wrong-step' });
      assert.equal(ctx.sent.length, 1);
      assert.equal(ctx.sent[0]!.to, 1);
      const { objid, subtype } = open(ctx.sent[0]!.buf);
      assert.equal(subtype, SNAPSHOTTYPE.TRADEPUTERROR);
      assert.equal(objid, 1);
    });

    it('PULL unstakes and echoes to both sides', () => {
      const a = makePlayer(1); const b = makePlayer(2);
      a.m_Inventory[0] = item(111, 1, 0);
      const ctx = makeCtx([a, b]);
      openTrade(ctx, a, b);
      ctx.svc.put(a, 4, 0, 0, 1);
      ctx.sent.length = 0;

      assert.deepEqual(ctx.svc.pull(a, 4), { ok: true });
      assert.equal(a.m_vtInfo.items[4], null);
      assert.deepEqual(subtypes(ctx.sent), [SNAPSHOTTYPE.TRADEPULL, SNAPSHOTTYPE.TRADEPULL]);
      assert.deepEqual(ctx.svc.pull(a, 4), { ok: false, reason: 'empty' });
    });
  });

  describe('gold escrow', () => {
    it('debits the bag at stake time, clamped to what the player holds', () => {
      const a = makePlayer(1, 500); const b = makePlayer(2);
      const ctx = makeCtx([a, b]);
      openTrade(ctx, a, b);

      assert.deepEqual(ctx.svc.putGold(a, 900), { ok: true });
      assert.equal(a.m_vtInfo.gold, 500);        // clamped
      assert.equal(a.m_nGold, 0);                // debited NOW
      assert.equal(ctx.journal.at(-1)!.type, 'CHAR_GOLD');
      assert.deepEqual(ctx.journal.at(-1)!.payload, { gold: 0 });
      assert.deepEqual(subtypes(ctx.sent), [SNAPSHOTTYPE.TRADEPUTGOLD, SNAPSHOTTYPE.TRADEPUTGOLD]);
    });

    it('re-staking refunds the prior stake instead of eating it', () => {
      const a = makePlayer(1, 500); const b = makePlayer(2);
      const ctx = makeCtx([a, b]);
      openTrade(ctx, a, b);

      ctx.svc.putGold(a, 300);
      assert.equal(a.m_nGold, 200);
      ctx.svc.putGold(a, 100);                   // lower the stake
      assert.equal(a.m_vtInfo.gold, 100);
      assert.equal(a.m_nGold, 400);              // 500 - 100, not 100
    });

    it('cancel refunds staged gold on BOTH sides', () => {
      const a = makePlayer(1, 500); const b = makePlayer(2, 800);
      const ctx = makeCtx([a, b]);
      openTrade(ctx, a, b);
      ctx.svc.putGold(a, 500);
      ctx.svc.putGold(b, 800);
      ctx.sent.length = 0;

      assert.deepEqual(ctx.svc.cancel(a, 0), { ok: true });
      assert.equal(a.m_nGold, 500);
      assert.equal(b.m_nGold, 800);
      assert.equal(a.m_vtInfo.busy, false);
      assert.equal(b.m_vtInfo.busy, false);

      const { objid, subtype, r } = open(ctx.sent[0]!.buf);
      assert.equal(subtype, SNAPSHOTTYPE.TRADECANCEL);
      assert.equal(objid, 1);                    // the canceller
      assert.equal(r.readDword(), 1);            // uidPlayer
      assert.equal(r.readDword(), 0);            // nMode
    });

    it('disconnect refunds gold and unwedges the surviving partner', () => {
      const a = makePlayer(1, 500); const b = makePlayer(2, 100);
      const ctx = makeCtx([a, b]);
      openTrade(ctx, a, b);
      ctx.svc.putGold(a, 500);
      ctx.svc.putGold(b, 100);
      ctx.sent.length = 0;

      ctx.svc.onDisconnect(a);
      assert.equal(a.m_nGold, 500);
      assert.equal(b.m_nGold, 100);
      assert.equal(b.m_vtInfo.busy, false);
      // Only the survivor is notified.
      assert.deepEqual(ctx.sent.map((f) => f.to), [2]);
      assert.equal(open(ctx.sent[0]!.buf).subtype, SNAPSHOTTYPE.TRADECANCEL);
    });
  });

  describe('two-phase commit', () => {
    it('OK echoes TRADEOK; the second OK promotes both to LASTCONFIRM', () => {
      const a = makePlayer(1); const b = makePlayer(2);
      const ctx = makeCtx([a, b]);
      openTrade(ctx, a, b);

      ctx.svc.ok(a);
      assert.equal(a.m_vtInfo.state, TRADE_STEP.OK);
      assert.deepEqual(subtypes(ctx.sent), [SNAPSHOTTYPE.TRADEOK, SNAPSHOTTYPE.TRADEOK]);
      ctx.sent.length = 0;

      ctx.svc.ok(b);
      assert.deepEqual(subtypes(ctx.sent),
        [SNAPSHOTTYPE.TRADELASTCONFIRM, SNAPSHOTTYPE.TRADELASTCONFIRM]);
      // TRADELASTCONFIRM carries NULL_ID, not a player objid.
      assert.equal(open(ctx.sent[0]!.buf).objid, NULL_ID);
    });

    it('first confirm -> CONFIRM + LASTCONFIRMOK; second -> commit + CONSENT', () => {
      const a = makePlayer(1); const b = makePlayer(2);
      a.m_Inventory[0] = item(111, 3, 0);
      b.m_Inventory[0] = item(222, 1, 0);
      const ctx = makeCtx([a, b]);
      openTrade(ctx, a, b);
      ctx.svc.put(a, 0, 0, 0, 3);
      ctx.svc.put(b, 0, 0, 0, 1);
      ctx.svc.ok(a); ctx.svc.ok(b);
      ctx.sent.length = 0;

      ctx.svc.lastConfirm(a);
      assert.equal(a.m_vtInfo.state, TRADE_STEP.CONFIRM);
      assert.deepEqual(subtypes(ctx.sent),
        [SNAPSHOTTYPE.TRADELASTCONFIRMOK, SNAPSHOTTYPE.TRADELASTCONFIRMOK]);
      ctx.sent.length = 0;

      assert.deepEqual(ctx.svc.lastConfirm(b), { ok: true });
      assert.deepEqual(subtypes(ctx.sent),
        [SNAPSHOTTYPE.TRADECONSENT, SNAPSHOTTYPE.TRADECONSENT]);
      assert.equal(open(ctx.sent[0]!.buf).objid, NULL_ID);

      // Items crossed over; both windows cleared.
      assert.equal(a.m_Inventory[0]!.itemId, 222);
      assert.equal(b.m_Inventory[0]!.itemId, 111);
      assert.equal(b.m_Inventory[0]!.count, 3);
      assert.equal(a.m_vtInfo.busy, false);
      assert.equal(b.m_vtInfo.busy, false);
    });

    it('partial stack splits: giver keeps the remainder', () => {
      const a = makePlayer(1); const b = makePlayer(2);
      a.m_Inventory[0] = item(111, 10, 0);
      const ctx = makeCtx([a, b]);
      openTrade(ctx, a, b);
      ctx.svc.put(a, 0, 0, 0, 4);
      runCommit(ctx, a, b);

      assert.equal(a.m_Inventory[0]!.count, 6);       // remainder stays
      assert.equal(b.m_Inventory[0]!.itemId, 111);
      assert.equal(b.m_Inventory[0]!.count, 4);
    });

    it('gold crosses over and journals CHAR_GOLD for both', () => {
      const a = makePlayer(1, 1_000); const b = makePlayer(2, 50);
      const ctx = makeCtx([a, b]);
      openTrade(ctx, a, b);
      ctx.svc.putGold(a, 400);
      runCommit(ctx, a, b);

      assert.equal(a.m_nGold, 600);                  // 1000 - 400 staked
      assert.equal(b.m_nGold, 450);                  // 50 + 400 received
      // The stake must not be refunded on top of the transfer. Journal order
      // follows the commit's argument order (the confirming side first), so
      // assert the last event per character rather than a fixed sequence.
      const goldEvents = ctx.journal.filter((e) => e.type === 'CHAR_GOLD');
      const lastFor = (id: number) =>
        goldEvents.filter((e) => e.charId === id).at(-1)!.payload;
      assert.deepEqual(lastFor(1), { gold: 600 });
      assert.deepEqual(lastFor(2), { gold: 450 });
    });

    it('journals absolute INVENTORY_SLOT for every touched slot before ack', () => {
      const a = makePlayer(1); const b = makePlayer(2);
      a.m_Inventory[0] = item(111, 1, 0);
      const ctx = makeCtx([a, b]);
      openTrade(ctx, a, b);
      ctx.svc.put(a, 0, 0, 0, 1);
      runCommit(ctx, a, b);

      const slotEvents = ctx.journal
        .filter((e) => e.type === 'INVENTORY_SLOT')
        .map((e) => ({ charId: e.charId, ...(e.payload as object) }))
        .sort((x, y) => x.charId - y.charId);
      // A's slot 0 emptied; B's slot 0 filled. (Emission order follows the
      // commit's argument order -- the confirming side first -- so sort by id.)
      assert.deepEqual(slotEvents, [
        { charId: 1, slot: 0, itemId: 0, count: 0 },
        { charId: 2, slot: 0, itemId: 111, count: 1 },
      ]);
    });
  });

  describe('commit re-validation (the dupe surface)', () => {
    it('aborts when a staked slot was emptied after staking', () => {
      const a = makePlayer(1, 100); const b = makePlayer(2);
      a.m_Inventory[0] = item(111, 1, 0);
      const ctx = makeCtx([a, b]);
      openTrade(ctx, a, b);
      ctx.svc.put(a, 0, 0, 0, 1);
      ctx.svc.putGold(a, 100);

      a.m_Inventory[0] = undefined;                  // dropped/used meanwhile
      ctx.sent.length = 0;
      ctx.svc.ok(a); ctx.svc.ok(b);
      ctx.svc.lastConfirm(a);
      ctx.sent.length = 0;
      assert.deepEqual(ctx.svc.lastConfirm(b), { ok: false, reason: 'commit-error' });

      // Nothing materialized on B, and A's gold came back.
      assert.equal(b.m_Inventory[0], undefined);
      assert.equal(a.m_nGold, 100);
      // TRADECANCEL with NULL_ID objid, per the C++ error path.
      assert.deepEqual(subtypes(ctx.sent), [SNAPSHOTTYPE.TRADECANCEL, SNAPSHOTTYPE.TRADECANCEL]);
      assert.equal(open(ctx.sent[0]!.buf).objid, NULL_ID);
    });

    it('aborts when the staked slot now holds a DIFFERENT item', () => {
      const a = makePlayer(1); const b = makePlayer(2);
      a.m_Inventory[0] = item(111, 1, 0);
      const ctx = makeCtx([a, b]);
      openTrade(ctx, a, b);
      ctx.svc.put(a, 0, 0, 0, 1);

      a.m_Inventory[0] = item(999, 1, 0);            // swapped
      runCommit(ctx, a, b);
      assert.equal(b.m_Inventory[0], undefined);
      assert.equal(a.m_Inventory[0]!.itemId, 999);   // untouched
    });

    it('aborts when the staked count exceeds what is left in the slot', () => {
      const a = makePlayer(1); const b = makePlayer(2);
      a.m_Inventory[0] = item(111, 10, 0);
      const ctx = makeCtx([a, b]);
      openTrade(ctx, a, b);
      ctx.svc.put(a, 0, 0, 0, 10);

      a.m_Inventory[0] = item(111, 2, 0);            // spent 8 meanwhile
      runCommit(ctx, a, b);
      assert.equal(b.m_Inventory[0], undefined);
      assert.equal(a.m_Inventory[0]!.count, 2);
    });

    it('aborts on a full receiving bag and leaves both bags intact', () => {
      const a = makePlayer(1); const b = makePlayer(2);
      a.m_Inventory[0] = item(111, 1, 0);
      for (let i = 0; i < 42; i++) b.m_Inventory[i] = item(500 + i, 1, i);
      const ctx = makeCtx([a, b]);
      openTrade(ctx, a, b);
      ctx.svc.put(a, 0, 0, 0, 1);

      runCommit(ctx, a, b);
      assert.equal(a.m_Inventory[0]!.itemId, 111);   // kept
      assert.equal(b.m_Inventory[41]!.itemId, 541);  // unchanged
    });

    it('a slot the receiver empties this commit can take an incoming item', () => {
      // B's bag is full, but B is giving away slot 7 -- A's item lands there.
      const a = makePlayer(1); const b = makePlayer(2);
      a.m_Inventory[0] = item(111, 1, 0);
      for (let i = 0; i < 42; i++) b.m_Inventory[i] = item(500 + i, 1, i);
      const ctx = makeCtx([a, b]);
      openTrade(ctx, a, b);
      ctx.svc.put(a, 0, 0, 0, 1);
      ctx.svc.put(b, 0, 0, 7, 1);                    // B gives the whole stack

      runCommit(ctx, a, b);
      assert.equal(b.m_Inventory[7]!.itemId, 111);   // reused the vacated slot
      assert.equal(a.m_Inventory[0]!.itemId, 507);   // A got B's item
    });
  });

  describe('partner integrity', () => {
    it('unwedges a player whose partner vanished from the manager', () => {
      const a = makePlayer(1, 100); const b = makePlayer(2);
      const ctx = makeCtx([a]);                      // b not registered
      a.m_vtInfo.otherId = 2;
      a.m_vtInfo.gold = 100;

      assert.deepEqual(ctx.svc.ok(a), { ok: false, reason: 'no-partner' });
      assert.equal(a.m_vtInfo.busy, false);
      assert.equal(a.m_nGold, 200);                  // stake refunded
    });

    it('rejects a one-sided link (partner points elsewhere)', () => {
      const a = makePlayer(1); const b = makePlayer(2);
      const ctx = makeCtx([a, b]);
      a.m_vtInfo.otherId = 2;
      b.m_vtInfo.otherId = 3;                        // not pointing back
      assert.deepEqual(ctx.svc.put(a, 0, 0, 0, 1), { ok: false, reason: 'no-partner' });
    });
  });

  describe('nId is an objid, not a slot', () => {
    it('stakes the item whose objid matches, not m_Inventory[nId]', () => {
      const a = makePlayer(1); const b = makePlayer(2);
      // The item the client is dragging lives in slot 5 but kept objid 2 after
      // an equip/unequip round trip. Slot 2 holds an unrelated item.
      a.m_Inventory[2] = item(777, 1, 9);
      a.m_Inventory[5] = item(111, 3, 2);
      const ctx = makeCtx([a, b]);
      openTrade(ctx, a, b);

      assert.deepEqual(ctx.svc.put(a, 0, 0, 2, 3), { ok: true });
      assert.deepEqual(a.m_vtInfo.items[0], { slot: 5, objid: 2, itemId: 111, count: 3 });

      // The echo carries the ORIGINAL nId (the client re-resolves via GetItemId).
      const { r } = open(ctx.sent[0]!.buf);
      assert.equal(r.readByte(), 0);       // window index
      r.readByte();                        // itemType
      assert.equal(r.readByte(), 2);       // nId, echoed verbatim
      assert.equal(r.readWord(), 3);       // clamped count

      // And the commit moves the real item, not slot 2's occupant.
      runCommit(ctx, a, b);
      assert.equal(a.m_Inventory[5], null);
      assert.equal(a.m_Inventory[2]!.itemId, 777);   // untouched
      assert.equal(b.m_Inventory[0]!.itemId, 111);
      assert.equal(b.m_Inventory[0]!.count, 3);
    });

    it('refuses a put for an objid no bag slot carries', () => {
      const a = makePlayer(1); const b = makePlayer(2);
      a.m_Inventory[0] = item(111, 1, 4);
      const ctx = makeCtx([a, b]);
      openTrade(ctx, a, b);
      // objid 61 is not held by any slot, and 61 is not itself an occupied slot.
      assert.equal(ctx.svc.put(a, 0, 0, 61, 1).ok, false);
      assert.equal(a.m_vtInfo.items[0], null);
    });
  });

  describe('late cancel after a successful commit', () => {
    it('is dropped instead of sending TRADECANCEL', () => {
      // CWndTrade::~CWndTrade fires SendTradeCancel() when OnTradeConsent
      // destroys the window -- AFTER the commit already cleared both sides.
      const a = makePlayer(1); const b = makePlayer(2);
      a.m_Inventory[0] = item(111, 1, 0);
      const ctx = makeCtx([a, b]);
      openTrade(ctx, a, b);
      ctx.svc.put(a, 0, 0, 0, 1);
      runCommit(ctx, a, b);
      assert.deepEqual(subtypes(ctx.sent).slice(-2),
        [SNAPSHOTTYPE.TRADECONSENT, SNAPSHOTTYPE.TRADECONSENT]);

      ctx.sent.length = 0;
      assert.deepEqual(ctx.svc.cancel(a, 0), { ok: false, reason: 'no-partner' });
      assert.deepEqual(ctx.svc.cancel(b, 0), { ok: false, reason: 'no-partner' });
      assert.deepEqual(ctx.sent, []);                // no cancel popup either side
      // The traded item stays where the commit put it.
      assert.equal(b.m_Inventory[0]!.itemId, 111);
    });
  });
});

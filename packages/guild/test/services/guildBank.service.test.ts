/**
 * GuildBankService tests -- the 42-slot shared warehouse.
 *
 * Every case is a port of a `CDPSrvr::OnOpenGuildBankWnd` / `OnPutItemGuildBank`
 * / `OnGetItemGuildBank` / `OnGuildBankMoveItem` branch (`WORLDSERVER/DPSrvr.cpp
 * :3271, 3370, 3574, 3666, 3786`), so each asserts the wire effect AND that the
 * bag/bank/contribution state moved (or did not).
 *
 * The two properties worth pinning hardest:
 *   1. EVERY opcode re-checks `IsCloseNpc( MMI_GUILDBANKING, ... )` -- opening
 *      the window and walking away must not keep transacting (`:3590`, `:3682`).
 *   2. Item echoes reach only members with the window open (`User.cpp:5336`),
 *      but penya echoes reach EVERY online member (`DPSrvr.cpp:3716`).
 * @module services/guildBank.service.test
 */

import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import {
  NULL_ID, GUD_KINGPIN, PF_PENYA, PF_ITEM,
  MAX_GUILDBANK, MAX_LEN_MOVER_MENU_SQ,
  GUILD_BANK_ECHO_SELF, GUILD_BANK_ECHO_PEER,
  GUILD_BANK_ECHO_PENYA_SELF, GUILD_BANK_ECHO_PENYA_PEER,
} from '@flyff/world-core';
import { MMI_GUILDBANKING } from '@flyff/resources';
import type { CPlayer, InventorySlot } from '@flyff/entities';
import {
  GuildBankService, WITHDRAW_MODE_PENYA, WITHDRAW_MODE_ITEM,
  type GuildBankInventoryPort, type GuildBankPersistence,
} from '../../src/services/guildBank.service';
import { GuildManager, type GuildPersistence } from '../../src/managers/guild.manager';

interface MockPlayer {
  m_idPlayer: number;
  m_szName: string;
  m_idGuild: number;
  m_nZoneId: number;
  m_vPos: { x: number; y: number; z: number };
}

function makePlayer(id: number): MockPlayer & CPlayer {
  return {
    m_idPlayer: id, m_szName: `P${id}`, m_idGuild: NULL_ID,
    m_nZoneId: 1, m_vPos: { x: 0, y: 0, z: 0 },
  } as MockPlayer & CPlayer;
}

/** Leading DWORD -- every snapshot frame starts with PACKETTYPE_SNAPSHOT. */
function op(buf: Buffer): number { return buf.readUInt32LE(0); }
/** Subtype WORD of a snapshot record (prefix is 4+4+2+4 = 14 bytes). */
function subtype(buf: Buffer): number { return buf.readUInt16LE(14); }
/** The echo discriminator BYTE that follows the 16-byte snapshot prefix. */
function recipient(buf: Buffer): number { return buf.readUInt8(16); }

/** A recording {@link GuildPersistence} -- the guild manager's own repo. */
function fakeGuildRepo(): GuildPersistence {
  const noop = async (): Promise<void> => {};
  return {
    loadAll: async () => [],
    maxId: async () => 0,
    loadAllCooldowns: async () => new Map<number, number>(),
    create: noop as GuildPersistence['create'],
    update: noop as GuildPersistence['update'],
    addMember: noop as GuildPersistence['addMember'],
    removeMember: noop as GuildPersistence['removeMember'],
    updateMember: noop as GuildPersistence['updateMember'],
    remove: noop as GuildPersistence['remove'],
    setCooldown: noop as GuildPersistence['setCooldown'],
  };
}

/** A recording {@link GuildBankPersistence} with a scriptable `loadAll`. */
function fakeBankRepo() {
  type Row = Awaited<ReturnType<GuildBankPersistence['loadAll']>> extends Map<number, infer R>
    ? R : never;
  const state = {
    rows: new Map<number, Row>(),
    calls: [] as Array<{ method: string; args: unknown[] }>,
  };
  const rec = (method: string) =>
    async (...args: unknown[]): Promise<void> => { state.calls.push({ method, args }); };
  const repo: GuildBankPersistence = {
    loadAll: async () => state.rows,
    setSlot: rec('setSlot') as GuildBankPersistence['setSlot'],
    clearSlot: rec('clearSlot') as GuildBankPersistence['clearSlot'],
    moveSlot: rec('moveSlot') as GuildBankPersistence['moveSlot'],
  };
  return { repo, state };
}

/** One bag row. */
function bagItem(over: Partial<InventorySlot> = {}): InventorySlot {
  return {
    itemId: 0x1000, count: 3, objid: 0, refine: 1, element: 2,
    element_level: 3, flags: 4, durability: 55,
    ...over,
  };
}

/**
 * A hand-rolled {@link GuildBankInventoryPort} over a sparse bag + a gold
 * counter. `addItem` returns the first free bag slot, or -1 when `bagFull`.
 */
function fakeInventory(init: { bag?: (InventorySlot | null)[]; gold?: number } = {}) {
  const state = {
    bag: init.bag ?? new Array<InventorySlot | null>(8).fill(null),
    gold: init.gold ?? 0,
    bagFull: false,
    removeItemOk: true,
    depositBlocked: false,
    canAddGoldOk: true,
    removed: [] as Array<{ slot: number; count: number }>,
    added: [] as InventorySlot[],
    credited: [] as number[],
  };
  const inventory: GuildBankInventoryPort = {
    getSlot: (_p, slot) => state.bag[slot] ?? null,
    removeItem: (_p, slot, count) => {
      if (!state.removeItemOk) return false;
      state.removed.push({ slot, count });
      const s = state.bag[slot];
      if (s) {
        if (s.count > count) s.count -= count;
        else state.bag[slot] = null;
      }
      return true;
    },
    addItem: (_p, item) => {
      if (state.bagFull) return -1;
      const dst = state.bag.findIndex((s) => s === null);
      if (dst === -1) return -1;
      state.bag[dst] = item;
      state.added.push(item);
      return dst;
    },
    addGold: (_p, amount) => { state.gold += amount; state.credited.push(amount); },
    canAddGold: () => state.canAddGoldOk,
    isDepositBlocked: () => state.depositBlocked,
  };
  return { inventory, state };
}

/** A fake `SpawnManager.inZone` returning one settable NPC. */
function fakeSpawnManager() {
  const npc = {
    m_abMoverMenu: [MMI_GUILDBANKING] as number[],
    m_vPos: { x: 0, y: 0, z: 0 },
    m_nZoneId: 1,
  };
  return {
    npc,
    spawnManager: { inZone: (_zoneId: number) => [npc] },
  };
}

describe('GuildBankService', () => {
  let a: MockPlayer & CPlayer; // master
  let b: MockPlayer & CPlayer; // kingpin peer
  let harness: {
    players: Map<number, CPlayer>;
    sent: Array<{ id: number; buf: Buffer }>;
    playerManager: { get: (id: number) => CPlayer | undefined; sendTo: (p: CPlayer, buf: Buffer) => void };
  };
  let manager: GuildManager;
  let spawn: ReturnType<typeof fakeSpawnManager>;
  let bankRepo: ReturnType<typeof fakeBankRepo>;
  let enabled: boolean;

  function makeHarness() {
    const players = new Map<number, CPlayer>();
    const sent: Array<{ id: number; buf: Buffer }> = [];
    return {
      players, sent,
      playerManager: {
        get: (id: number) => players.get(id),
        sendTo: (p: CPlayer, buf: Buffer) => { sent.push({ id: p.m_idPlayer, buf }); },
      },
    };
  }

  function build(inv: GuildBankInventoryPort): GuildBankService {
    return new GuildBankService({
      playerManager: harness.playerManager as never,
      guildManager: manager,
      spawnManager: spawn.spawnManager as never,
      inventory: inv,
      repo: bankRepo.repo,
      guildInventoryEnabled: () => enabled,
    });
  }

  beforeEach(() => {
    a = makePlayer(1); b = makePlayer(2);
    harness = makeHarness();
    harness.players.set(1, a); harness.players.set(2, b);
    manager = new GuildManager(fakeGuildRepo(), () => 1_000_000);
    spawn = fakeSpawnManager();
    bankRepo = fakeBankRepo();
    enabled = true;
  });

  /** A 2-member guild: 1 = master, 2 = kingpin. */
  function guild() {
    const g = manager.create('Braves', 1, [2])!;
    manager.setMemberLevel(g.id, 2, GUD_KINGPIN);
    return g;
  }

  /** Grant a PF_* bit to the kingpin rank (the master already has 0xff). */
  function grantKingpin(guildId: number, power: number): void {
    const g = manager.get(guildId)!;
    g.power[GUD_KINGPIN] = power;
  }

  function reset(): void { harness.sent.length = 0; }
  function mine(id: number): Buffer[] {
    return harness.sent.filter((s) => s.id === id).map((s) => s.buf);
  }

  describe('proximity gate (IsCloseNpc MMI_GUILDBANKING)', () => {
    it('open_ refuses with no MMI_GUILDBANKING NPC in range', () => {
      guild();
      spawn.npc.m_abMoverMenu = [1, 2, 3]; // a banker without the guild menu
      const { inventory } = fakeInventory();
      const svc = build(inventory);
      svc.open_(a);
      assert.equal(svc.isOpen(1), false);
      assert.equal(harness.sent.length, 0);
    });

    it('an NPC in another zone is not consulted', () => {
      guild();
      a.m_nZoneId = 7; // fakeSpawnManager returns the same npc for any zone,
      spawn.spawnManager.inZone = (zoneId: number) => (zoneId === 1 ? [spawn.npc] : []);
      const svc = build(fakeInventory().inventory);
      svc.open_(a);
      assert.equal(svc.isOpen(1), false);
    });

    it('distance 32 is INSIDE (1024 <= MAX_LEN_MOVER_MENU_SQ), 33 is outside', () => {
      guild();
      const svc = build(fakeInventory().inventory);
      assert.equal(MAX_LEN_MOVER_MENU_SQ, 1024);

      a.m_vPos = { x: 32, y: 0, z: 0 };      // 32^2 = 1024 -- the boundary
      svc.open_(a);
      assert.equal(svc.isOpen(1), true, 'the boundary is inclusive');
      assert.equal(subtype(harness.sent[0].buf), SNAPSHOTTYPE.GUILD_BANK_WND);

      svc.close(a);
      reset();
      a.m_vPos = { x: 33, y: 0, z: 0 };      // 1089 > 1024
      svc.open_(a);
      assert.equal(svc.isOpen(1), false);
      assert.equal(harness.sent.length, 0);
    });

    it('the check is XZ only -- y never counts', () => {
      guild();
      const svc = build(fakeInventory().inventory);
      a.m_vPos = { x: 0, y: 9999, z: 0 };
      svc.open_(a);
      assert.equal(svc.isOpen(1), true);
    });

    it('putItem and getItem BOTH re-check proximity after the window opened', () => {
      const g = guild();
      grantKingpin(g.id, PF_PENYA | PF_ITEM);
      manager.setGold(g.id, 5_000);
      const { inventory, state } = fakeInventory({ bag: [bagItem(), null, null] });
      const svc = build(inventory);
      svc.open_(a);
      assert.equal(svc.isOpen(1), true);
      // seed one bank slot so the withdrawal has something to take
      svc.bank(g.id)[0] = {
        itemId: 0x2000, count: 5, objid: 0, refine: 0, element: 0,
        element_level: 0, flags: 0, durability: -1,
      };
      reset();

      a.m_vPos = { x: 500, y: 0, z: 0 };     // walked away, window still "open"
      svc.putItem(a, 0, 1, 1);
      svc.getItem(a, 0, 1, WITHDRAW_MODE_ITEM);
      svc.getItem(a, 0, 100, WITHDRAW_MODE_PENYA);

      assert.equal(svc.isOpen(1), true, 'the flag is untouched -- proximity is separate');
      assert.deepEqual(state.removed, [], 'no deposit');
      assert.deepEqual(state.added, [], 'no withdrawal');
      assert.deepEqual(state.credited, [], 'no penya');
      assert.equal(svc.bank(g.id)[0]!.count, 5, 'the bank slot is untouched');
      assert.equal(state.bag[0]!.count, 3, 'and so is the bag');
      assert.equal(harness.sent.length, 0);
    });

    it('open_ refuses while busy (trade / vendor / personal bank)', () => {
      guild();
      const svc = build(fakeInventory().inventory);
      svc.open_(a, true);
      assert.equal(svc.isOpen(1), false);
      assert.equal(harness.sent.length, 0);
      svc.open_(a, false);
      assert.equal(svc.isOpen(1), true);
    });

    it('open_ sends mode 0, the guild pool, and the 42-slot container to SELF', () => {
      const g = guild();
      manager.setGold(g.id, 777);
      const svc = build(fakeInventory().inventory);
      svc.open_(a);
      assert.deepEqual(harness.sent.map((s) => s.id), [1], 'nobody else is told');
      const buf = harness.sent[0].buf;
      assert.equal(op(buf), PACKETTYPE.SNAPSHOT);
      assert.equal(subtype(buf), SNAPSHOTTYPE.GUILD_BANK_WND);
      assert.equal(buf.readUInt32LE(10), 1, 'record objid is SELF');
      assert.equal(buf.readUInt32LE(16), 0, 'nMode 0 on open');
      assert.equal(buf.readUInt32LE(20), 777, 'm_nGoldGuild');
    });
  });

  describe('putItem (deposit)', () => {
    it('mode 0 (gold) is rejected outright -- penya cannot be deposited', () => {
      const g = guild();
      const { inventory, state } = fakeInventory({ bag: [bagItem()], gold: 10_000 });
      build(inventory).putItem(a, 0, 1, 0);
      assert.deepEqual(state.removed, [], 'nothing left the bag');
      assert.equal(state.gold, 10_000, 'and no penya moved');
      assert.equal(svcBankOccupied(g.id, build(inventory)), 0);
      assert.equal(harness.sent.length, 0);
    });

    /** Count of occupied slots in a guild's bank. */
    function svcBankOccupied(guildId: number, svc: GuildBankService): number {
      return svc.bank(guildId).filter((s) => s !== null).length;
    }

    it('happy path: item leaves the bag, lands in slot 0, SELF echo + open-peer PEER echo', () => {
      const g = guild();
      const { inventory, state } = fakeInventory({ bag: [bagItem({ itemId: 0xabc, count: 3 })] });
      const svc = build(inventory);
      svc.open_(a);
      svc.open_(b);           // the peer has the window open
      reset();

      svc.putItem(a, 0, 3, 1);

      assert.deepEqual(state.removed, [{ slot: 0, count: 3 }]);
      assert.equal(state.bag[0], null, 'the whole stack left the bag');
      const stored = svc.bank(g.id)[0]!;
      assert.equal(stored.itemId, 0xabc);
      assert.equal(stored.count, 3);
      assert.equal(stored.refine, 1, 'instance state survives the deposit');
      assert.equal(stored.element, 2);
      assert.equal(stored.element_level, 3);
      assert.equal(stored.flags, 4);
      assert.equal(stored.durability, 55);
      assert.equal(svcBankOccupied(g.id, svc), 1);

      const self = mine(1);
      assert.equal(self.length, 1);
      assert.equal(subtype(self[0]), SNAPSHOTTYPE.PUTITEMGUILDBANK);
      assert.equal(recipient(self[0]), GUILD_BANK_ECHO_SELF);
      assert.equal(self[0].readUInt32LE(21), 0xabc, 'm_dwItemId in the body');

      const peer = mine(2);
      assert.equal(peer.length, 1);
      assert.equal(recipient(peer[0]), GUILD_BANK_ECHO_PEER);

      // and the repo was told, with the depositor recorded for the bank log
      const set = bankRepo.state.calls.filter((c) => c.method === 'setSlot');
      assert.equal(set.length, 1);
      assert.deepEqual(set[0].args.slice(0, 2), [g.id, 0]);
      assert.equal((set[0].args[2] as { depositedBy: number }).depositedBy, 1);
    });

    it('a guild peer WITHOUT the window open gets nothing', () => {
      guild();
      const { inventory } = fakeInventory({ bag: [bagItem()] });
      const svc = build(inventory);
      svc.open_(a);           // only the depositor opened it
      reset();
      svc.putItem(a, 0, 1, 1);
      assert.deepEqual(harness.sent.map((s) => s.id), [1], 'User.cpp:5336 gates on m_bGuildBank');
    });

    it('count is clamped DOWN to the stack and floored at 1', () => {
      const g = guild();
      const { inventory, state } = fakeInventory({
        bag: [bagItem({ count: 3 }), bagItem({ itemId: 0x2000, count: 3 })],
      });
      const svc = build(inventory);

      svc.putItem(a, 0, 999, 1);
      assert.deepEqual(state.removed[0], { slot: 0, count: 3 }, '999 clamped to the stack');
      assert.equal(svc.bank(g.id)[0]!.count, 3);

      svc.putItem(a, 1, 0, 1);
      assert.deepEqual(state.removed[1], { slot: 1, count: 1 }, '0 floored to 1');
      assert.equal(svc.bank(g.id)[1]!.count, 1);
      assert.equal(state.bag[1]!.count, 2, 'the remainder stays in the bag');
    });

    it('the destination is the FIRST free slot, not the next one', () => {
      const g = guild();
      const { inventory } = fakeInventory({ bag: [bagItem(), bagItem({ itemId: 0x2 })] });
      const svc = build(inventory);
      svc.putItem(a, 0, 1, 1);
      svc.bank(g.id)[0] = null;             // slot 0 freed by a withdrawal
      svc.putItem(a, 1, 1, 1);
      assert.equal(svc.bank(g.id)[0]!.itemId, 0x2, 'reused slot 0');
      assert.equal(svc.bank(g.id)[1], null);
    });

    it('a full 42-slot bank refuses and leaves the item in the bag', () => {
      const g = guild();
      const { inventory, state } = fakeInventory({ bag: [bagItem()] });
      const svc = build(inventory);
      const bank = svc.bank(g.id);
      for (let i = 0; i < MAX_GUILDBANK; i++) {
        bank[i] = {
          itemId: 1, count: 1, objid: i, refine: 0, element: 0,
          element_level: 0, flags: 0, durability: -1,
        };
      }
      svc.open_(a);
      reset();
      svc.putItem(a, 0, 1, 1);
      assert.deepEqual(state.removed, [], 'TID_GAME_GUILDBANKFULL -- nothing removed');
      assert.equal(state.bag[0]!.count, 3);
      assert.equal(harness.sent.length, 0);
      assert.equal(bank.filter((s) => s !== null).length, MAX_GUILDBANK);
    });

    it('isDepositBlocked refuses before anything moves', () => {
      const g = guild();
      const { inventory, state } = fakeInventory({ bag: [bagItem()] });
      state.depositBlocked = true;
      const svc = build(inventory);
      svc.putItem(a, 0, 1, 1);
      assert.deepEqual(state.removed, []);
      assert.equal(svc.bank(g.id)[0], null);
      assert.equal(harness.sent.length, 0);
    });

    it('removeItem returning false aborts without writing the bank slot', () => {
      const g = guild();
      const { inventory, state } = fakeInventory({ bag: [bagItem()] });
      state.removeItemOk = false;
      const svc = build(inventory);
      svc.open_(a);
      reset();
      svc.putItem(a, 0, 1, 1);
      assert.equal(svc.bank(g.id)[0], null, 'the bag refused -- no free item');
      assert.equal(harness.sent.length, 0);
      assert.equal(bankRepo.state.calls.length, 0);
    });

    it('an empty or out-of-range bag slot is a no-op', () => {
      const g = guild();
      const { inventory, state } = fakeInventory({ bag: [null, bagItem()] });
      const svc = build(inventory);
      svc.putItem(a, 0, 1, 1);
      svc.putItem(a, 99, 1, 1);
      assert.deepEqual(state.removed, []);
      assert.equal(svc.bank(g.id).filter((s) => s !== null).length, 0);
    });
  });

  describe('getItem mode 0 (withdraw penya)', () => {
    function funded(gold = 1_000) {
      const g = guild();
      manager.setGold(g.id, gold);
      return g;
    }

    it('requires PF_PENYA -- refuses without the bit, succeeds with it', () => {
      const g = funded();
      const { inventory, state } = fakeInventory();
      const svc = build(inventory);

      // the kingpin's rank mask is 0 by default
      svc.getItem(b, 0, 100, WITHDRAW_MODE_PENYA);
      assert.deepEqual(state.credited, [], 'IsGetPenya refused');
      assert.equal(g.gold, 1_000);

      grantKingpin(g.id, PF_PENYA);
      svc.getItem(b, 0, 100, WITHDRAW_MODE_PENYA);
      assert.deepEqual(state.credited, [100]);
      assert.equal(g.gold, 900);
    });

    it('the master (power 0xff) always has it', () => {
      const g = funded();
      const { inventory, state } = fakeInventory();
      build(inventory).getItem(a, 0, 100, WITHDRAW_MODE_PENYA);
      assert.deepEqual(state.credited, [100]);
      assert.equal(g.gold, 900);
    });

    it('refuses a non-positive amount, an over-pool amount, and a gold-cap overflow', () => {
      const g = funded(500);
      const { inventory, state } = fakeInventory();
      const svc = build(inventory);

      svc.getItem(a, 0, 0, WITHDRAW_MODE_PENYA);
      svc.getItem(a, 0, -100, WITHDRAW_MODE_PENYA);
      svc.getItem(a, 0, 501, WITHDRAW_MODE_PENYA);
      assert.deepEqual(state.credited, []);
      assert.equal(g.gold, 500, 'nothing left the pool');

      state.canAddGoldOk = false;
      svc.getItem(a, 0, 500, WITHDRAW_MODE_PENYA);
      assert.deepEqual(state.credited, [], 'CanAdd( GetGold(), nGold ) refused');
      assert.equal(g.gold, 500);
      assert.equal(harness.sent.length, 0);

      state.canAddGoldOk = true;
      svc.getItem(a, 0, 500, WITHDRAW_MODE_PENYA);
      assert.equal(g.gold, 0, 'exactly the pool is allowed');
    });

    it('DECREMENTS the withdrawer giveGold contribution record (DPSrvr.cpp:3700)', () => {
      const g = funded(0);
      manager.addContribution(g.id, 1, 0, 1_000);   // the master donated 1000
      assert.equal(manager.getMember(g.id, 1)!.giveGold, 1_000);
      assert.equal(g.gold, 1_000);
      const { inventory, state } = fakeInventory();

      build(inventory).getItem(a, 0, 400, WITHDRAW_MODE_PENYA);

      assert.deepEqual(state.credited, [400], 'the player was paid');
      assert.equal(state.gold, 400);
      assert.equal(g.gold, 600, 'and the pool shrank');
      assert.equal(
        manager.getMember(g.id, 1)!.giveGold, 600,
        'DecrementMemberContribution -- taking money back un-credits the donation',
      );
      assert.equal(manager.getMember(g.id, 1)!.givePxp, 0, 'PXP untouched');
    });

    it('penya echoes reach EVERY online member, window open or not (mode 0 / mode 2)', () => {
      const g = funded();
      const { inventory } = fakeInventory();
      const svc = build(inventory);
      svc.open_(a);           // only the withdrawer opened the window
      assert.equal(svc.isOpen(2), false);
      reset();

      svc.getItem(a, 0, 250, WITHDRAW_MODE_PENYA);

      const self = mine(1);
      assert.equal(self.length, 1);
      assert.equal(subtype(self[0]), SNAPSHOTTYPE.GETITEMGUILDBANK);
      assert.equal(recipient(self[0]), GUILD_BANK_ECHO_PENYA_SELF);
      assert.equal(self[0].readUInt32LE(17), 250, 'gold');
      assert.equal(self[0].readUInt32LE(21), 1, 'the withdrawer id');
      assert.equal(self[0].length, 26, 'the PENYA body, not the item body');

      const peer = mine(2);
      assert.equal(peer.length, 1, 'the closed-window peer still hears it (:3716)');
      assert.equal(recipient(peer[0]), GUILD_BANK_ECHO_PENYA_PEER);
      assert.equal(peer[0].readUInt32LE(21), 1, 'naming who took it');
      assert.equal(g.gold, 750);
    });

    it('skips offline members in the penya fan-out', () => {
      funded();
      harness.players.delete(2);
      const { inventory } = fakeInventory();
      const svc = build(inventory);
      svc.getItem(a, 0, 100, WITHDRAW_MODE_PENYA);
      assert.deepEqual(harness.sent.map((s) => s.id), [1]);
    });
  });

  describe('getItem mode 1 (withdraw item)', () => {
    /** Seed one bank stack of `count`. */
    function stocked(count = 5) {
      const g = guild();
      const svc = build(fakeInventory().inventory);
      svc.bank(g.id)[2] = {
        itemId: 0x3000, count, objid: 2, refine: 6, element: 1,
        element_level: 2, flags: 0, durability: 40,
      };
      return { g, seededBank: svc.bank(g.id) };
    }

    it('requires PF_ITEM', () => {
      const { g } = stocked();
      const { inventory, state } = fakeInventory();
      const svc = build(inventory);
      // the service shares nothing between instances -- re-seed on this one
      svc.bank(g.id)[2] = {
        itemId: 0x3000, count: 5, objid: 2, refine: 0, element: 0,
        element_level: 0, flags: 0, durability: -1,
      };
      svc.getItem(b, 2, 1, WITHDRAW_MODE_ITEM);
      assert.deepEqual(state.added, [], 'IsGetItem refused');
      assert.equal(svc.bank(g.id)[2]!.count, 5);

      grantKingpin(g.id, PF_ITEM);
      svc.getItem(b, 2, 1, WITHDRAW_MODE_ITEM);
      assert.equal(state.added.length, 1);
      assert.equal(svc.bank(g.id)[2]!.count, 4);
    });

    it('a partial take leaves the remainder in the slot and emits no REMOVE', () => {
      const g = guild();
      const { inventory, state } = fakeInventory();
      const svc = build(inventory);
      svc.bank(g.id)[2] = {
        itemId: 0x3000, count: 5, objid: 2, refine: 6, element: 1,
        element_level: 2, flags: 0, durability: 40,
      };
      svc.open_(a); svc.open_(b);
      reset();

      svc.getItem(a, 2, 2, WITHDRAW_MODE_ITEM);

      assert.equal(svc.bank(g.id)[2]!.count, 3, 'remainder stays');
      assert.equal(state.added[0].count, 2, 'and 2 landed in the bag');
      assert.equal(state.added[0].refine, 6, 'with its enchant intact');
      const self = mine(1);
      assert.equal(self.length, 1);
      assert.equal(subtype(self[0]), SNAPSHOTTYPE.GETITEMGUILDBANK);
      assert.equal(recipient(self[0]), GUILD_BANK_ECHO_SELF);
      assert.equal(self[0].readUInt32LE(17), 2, 'objId, not the slot');
      const peer = mine(2);
      assert.equal(peer.length, 1);
      assert.equal(recipient(peer[0]), GUILD_BANK_ECHO_PEER);
      assert.equal(
        harness.sent.filter((s) => subtype(s.buf) === SNAPSHOTTYPE.REMOVE_GUILD_BANK_ITEM).length,
        0, 'the slot is still occupied',
      );
      const set = bankRepo.state.calls.filter((c) => c.method === 'setSlot');
      assert.equal(set.length, 1, 'the partial take persisted the new count');
      assert.equal(bankRepo.state.calls.filter((c) => c.method === 'clearSlot').length, 0);
    });

    it('a full take frees the slot and ALSO emits REMOVE_GUILD_BANK_ITEM', () => {
      const g = guild();
      const { inventory, state } = fakeInventory();
      const svc = build(inventory);
      svc.bank(g.id)[2] = {
        itemId: 0x3000, count: 5, objid: 2, refine: 0, element: 0,
        element_level: 0, flags: 0, durability: -1,
      };
      svc.open_(a); svc.open_(b);
      reset();

      svc.getItem(a, 2, 999, WITHDRAW_MODE_ITEM);

      assert.equal(svc.bank(g.id)[2], null, 'slot freed');
      assert.equal(state.added[0].count, 5, 'clamped up to the whole stack');
      const removes = harness.sent.filter(
        (s) => subtype(s.buf) === SNAPSHOTTYPE.REMOVE_GUILD_BANK_ITEM,
      );
      assert.deepEqual(removes.map((s) => s.id), [1, 2], 'both open windows are told');
      assert.equal(removes[0].buf.readUInt32LE(16), g.id, 'idGuild');
      assert.equal(removes[0].buf.readUInt32LE(20), 2, 'objId');
      assert.equal(removes[0].buf.readUInt32LE(24), 5, 'itemNum');
      assert.equal(bankRepo.state.calls.filter((c) => c.method === 'clearSlot').length, 1);
    });

    it('bag-full aborts and does NOT destroy the stack', () => {
      const g = guild();
      const { inventory, state } = fakeInventory();
      state.bagFull = true;
      const svc = build(inventory);
      svc.bank(g.id)[2] = {
        itemId: 0x3000, count: 5, objid: 2, refine: 0, element: 0,
        element_level: 0, flags: 0, durability: -1,
      };
      svc.open_(a);
      reset();

      svc.getItem(a, 2, 5, WITHDRAW_MODE_ITEM);

      assert.equal(svc.bank(g.id)[2]!.count, 5, 'the bank insert happens AFTER the bag add');
      assert.deepEqual(state.added, []);
      assert.equal(harness.sent.length, 0);
      assert.equal(bankRepo.state.calls.length, 0);
    });

    it('an out-of-range or empty bank slot refuses', () => {
      guild();
      const { inventory, state } = fakeInventory();
      const svc = build(inventory);
      for (const slot of [-1, MAX_GUILDBANK, 999, 0]) {
        svc.getItem(a, slot, 1, WITHDRAW_MODE_ITEM);
      }
      assert.deepEqual(state.added, []);
      assert.equal(harness.sent.length, 0);
    });

    it('any mode other than 0 takes the item path', () => {
      const g = guild();
      const { inventory, state } = fakeInventory();
      const svc = build(inventory);
      svc.bank(g.id)[0] = {
        itemId: 7, count: 1, objid: 0, refine: 0, element: 0,
        element_level: 0, flags: 0, durability: -1,
      };
      // Documented divergence, not a spec claim: C++ is `if (mode == 0) ... else
      // if (mode == 1)`, so mode 2+ falls through and does nothing there. Ours
      // treats every non-zero mode as the item branch. Harmless (the client only
      // ever sends 0 or 1) but pinned so a future tightening is a deliberate act.
      svc.getItem(a, 0, 1, 9);
      assert.equal(state.added.length, 1, 'mode != 0 is the item branch');
      assert.equal(WITHDRAW_MODE_ITEM, 1);
      assert.equal(WITHDRAW_MODE_PENYA, 0);
    });
  });

  describe('moveItem', () => {
    /** Seed two occupied slots, 0 and 3. */
    function twoSlots(svc: GuildBankService, guildId: number): void {
      const bank = svc.bank(guildId);
      bank[0] = {
        itemId: 0xa, count: 1, objid: 0, refine: 0, element: 0,
        element_level: 0, flags: 0, durability: -1,
      };
      bank[3] = {
        itemId: 0xb, count: 2, objid: 3, refine: 0, element: 0,
        element_level: 0, flags: 0, durability: -1,
      };
    }

    it('swaps two occupied slots and resends the whole window', () => {
      const g = guild();
      const svc = build(fakeInventory().inventory);
      twoSlots(svc, g.id);
      reset();

      svc.moveItem(a, 0, 3);
      const bank = svc.bank(g.id);
      assert.equal(bank[0]!.itemId, 0xb);
      assert.equal(bank[3]!.itemId, 0xa);
      assert.deepEqual(harness.sent.map((s) => s.id), [1], 'only the mover is resent');
      assert.equal(subtype(harness.sent[0].buf), SNAPSHOTTYPE.GUILD_BANK_WND);
      assert.equal(bankRepo.state.calls.filter((c) => c.method === 'moveSlot').length, 1);
    });

    it('moves into an empty slot, leaving the source empty', () => {
      const g = guild();
      const svc = build(fakeInventory().inventory);
      twoSlots(svc, g.id);
      svc.moveItem(a, 0, 10);
      const bank = svc.bank(g.id);
      assert.equal(bank[0], null);
      assert.equal(bank[10]!.itemId, 0xa);
    });

    it('src === dst, out-of-range, and an empty src are all no-ops', () => {
      const g = guild();
      const svc = build(fakeInventory().inventory);
      twoSlots(svc, g.id);
      reset();
      svc.moveItem(a, 0, 0);
      svc.moveItem(a, -1, 3);
      svc.moveItem(a, 0, MAX_GUILDBANK);
      svc.moveItem(a, MAX_GUILDBANK, 0);
      svc.moveItem(a, 5, 6);   // src empty
      assert.equal(svc.bank(g.id)[0]!.itemId, 0xa, 'nothing moved');
      assert.equal(svc.bank(g.id)[3]!.itemId, 0xb);
      assert.equal(svc.bank(g.id)[6], null);
      assert.equal(harness.sent.length, 0, 'and no window resend');
      assert.equal(bankRepo.state.calls.length, 0);
    });

    /**
     * REGRESSION PIN. `moveItem` must carry `objid` with the slot, because the
     * window resend serializes each slot's `m_dwObjId` as its ARRAY INDEX
     * (`writeItemContainer` -> `writeCItemElemBody(w, i, ...)`) while the
     * withdraw echoes send `stored.objid`. If the two disagree, the client
     * resolves the echo through `m_GuildBank.GetAtId( m_dwObjId )`
     * (`DPClient.cpp` `OnGetItemGuildBank`, GUILD_ITEM_MINE_UPDATE), the lookup
     * yields NULL, and the whole withdrawal echo is DROPPED client-side -- the
     * grid keeps showing an item the server already handed out.
     *
     * C++ has no conflict to fix here: `m_dwObjId` IS the `m_apItem` index and a
     * move only permutes `m_apIndex`, so the id never travels. Our bank is one
     * flat array indexed by slot, so the id has to be re-stamped on move.
     */
    it('carries objid with the slot on move, so window and echo agree', () => {
      const g = guild();
      const { inventory } = fakeInventory();
      const svc = build(inventory);
      twoSlots(svc, g.id);
      svc.open_(a);
      svc.moveItem(a, 0, 10);

      const moved = svc.bank(g.id)[10]!;
      assert.equal(moved.objid, 10, 'objid follows the item to its new slot');

      // The window resend writes the array index; objid now matches it.
      const wnd = harness.sent[harness.sent.length - 1].buf;
      const off = 24 + MAX_GUILDBANK * 4;         // past mode + gold + m_apIndex
      assert.equal(wnd.readUInt8(off), 2, 'chSize');
      assert.equal(wnd.readUInt8(off + 1), 3, 'first occupied slot byte (slot 3)');
      assert.equal(wnd.readUInt32LE(off + 2), 3, 'm_dwObjId = the array index');
      reset();

      svc.getItem(a, 10, 1, WITHDRAW_MODE_ITEM);
      const echo = mine(1)[0];
      assert.equal(
        echo.readUInt32LE(17), 10,
        'the echo carries the CURRENT objid, so the client GetAtId lookup hits',
      );
    });

    it('swaps objid on both sides of an occupied-to-occupied move', () => {
      const g = guild();
      const { inventory } = fakeInventory();
      const svc = build(inventory);
      twoSlots(svc, g.id);   // slots 0 and 3 occupied
      svc.moveItem(a, 0, 3);
      assert.equal(svc.bank(g.id)[3]!.objid, 3, 'moved item takes the dst objid');
      assert.equal(svc.bank(g.id)[0]!.objid, 0, 'displaced item takes the src objid');
    });
  });

  describe('window flag lifecycle', () => {
    it('close stops the peer echo', () => {
      guild();
      const { inventory } = fakeInventory({ bag: [bagItem(), bagItem({ itemId: 0x2 })] });
      const svc = build(inventory);
      svc.open_(a); svc.open_(b);
      reset();
      svc.putItem(a, 0, 1, 1);
      assert.deepEqual(harness.sent.map((s) => s.id), [1, 2]);

      svc.close(b);
      assert.equal(svc.isOpen(2), false);
      reset();
      svc.putItem(a, 1, 1, 1);
      assert.deepEqual(harness.sent.map((s) => s.id), [1]);
    });

    it('onDisconnect clears the flag too', () => {
      guild();
      const { inventory } = fakeInventory({ bag: [bagItem()] });
      const svc = build(inventory);
      svc.open_(a); svc.open_(b);
      svc.onDisconnect(2);
      assert.equal(svc.isOpen(2), false);
      reset();
      svc.putItem(a, 0, 1, 1);
      assert.deepEqual(harness.sent.map((s) => s.id), [1]);
    });
  });

  describe('guildInventoryEnabled = false', () => {
    it('makes open / put / get / move total no-ops', () => {
      const g = guild();
      manager.setGold(g.id, 1_000);
      const { inventory, state } = fakeInventory({ bag: [bagItem()] });
      const svc = build(inventory);
      svc.bank(g.id)[1] = {
        itemId: 9, count: 4, objid: 1, refine: 0, element: 0,
        element_level: 0, flags: 0, durability: -1,
      };
      enabled = false;

      svc.open_(a);
      svc.putItem(a, 0, 1, 1);
      svc.getItem(a, 1, 1, WITHDRAW_MODE_ITEM);
      svc.getItem(a, 0, 100, WITHDRAW_MODE_PENYA);
      svc.moveItem(a, 1, 2);

      assert.equal(svc.isOpen(1), false);
      assert.deepEqual(state.removed, []);
      assert.deepEqual(state.added, []);
      assert.deepEqual(state.credited, []);
      assert.equal(g.gold, 1_000);
      assert.equal(svc.bank(g.id)[1]!.count, 4);
      assert.equal(svc.bank(g.id)[2], null);
      assert.equal(harness.sent.length, 0);
      assert.equal(bankRepo.state.calls.length, 0);
    });
  });

  describe('hydrate', () => {
    it('restores rows into their own indices and ignores an out-of-range slot', () => {
      const g = guild();
      bankRepo.state.rows.set(g.id, [
        {
          slot: 0, itemId: 0xa, count: 2, objid: 77, refine: 3, element: 1,
          elementLevel: 4, flags: 5, durability: 60, stats: null,
          depositedBy: 1, depositedAtMs: 0,
        },
        {
          slot: 41, itemId: 0xb, count: 1, objid: null, refine: 0, element: 0,
          elementLevel: 0, flags: 0, durability: -1, stats: null,
          depositedBy: 2, depositedAtMs: 0,
        },
        {
          slot: MAX_GUILDBANK, itemId: 0xc, count: 1, objid: 5, refine: 0, element: 0,
          elementLevel: 0, flags: 0, durability: -1, stats: null,
          depositedBy: null, depositedAtMs: 0,
        },
      ]);
      const svc = build(fakeInventory().inventory);
      return svc.hydrate().then(() => {
        const bank = svc.bank(g.id);
        assert.equal(bank.length, MAX_GUILDBANK);
        assert.equal(bank[0]!.itemId, 0xa);
        assert.equal(bank[0]!.objid, 77);
        assert.equal(bank[0]!.refine, 3);
        assert.equal(bank[0]!.element_level, 4, 'elementLevel -> element_level');
        assert.equal(bank[41]!.itemId, 0xb);
        assert.equal(bank[41]!.objid, 41, 'a null objid falls back to the slot index');
        assert.equal(
          bank.filter((s) => s !== null).length, 2,
          'the out-of-range row was dropped, not appended',
        );
      });
    });

    it('is a no-op with no repo configured', async () => {
      const svc = new GuildBankService({
        playerManager: harness.playerManager as never,
        guildManager: manager,
        spawnManager: spawn.spawnManager as never,
        inventory: fakeInventory().inventory,
      });
      await svc.hydrate();
      assert.equal(svc.bank(1).filter((s) => s !== null).length, 0);
    });
  });

  describe('a guildless player', () => {
    it('is a no-op on every entry point', () => {
      const stranger = makePlayer(9);
      harness.players.set(9, stranger);
      const { inventory, state } = fakeInventory({ bag: [bagItem()], gold: 100 });
      const svc = build(inventory);

      svc.open_(stranger);
      svc.putItem(stranger, 0, 1, 1);
      svc.getItem(stranger, 0, 1, WITHDRAW_MODE_ITEM);
      svc.getItem(stranger, 0, 50, WITHDRAW_MODE_PENYA);
      svc.moveItem(stranger, 0, 1);

      assert.equal(svc.isOpen(9), false);
      assert.deepEqual(state.removed, []);
      assert.deepEqual(state.added, []);
      assert.deepEqual(state.credited, []);
      assert.equal(harness.sent.length, 0);
      assert.equal(bankRepo.state.calls.length, 0);
    });
  });
});

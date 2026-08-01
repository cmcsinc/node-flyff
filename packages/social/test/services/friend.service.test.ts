/**
 * FriendService tests -- the `CRTMessenger` roster.
 *
 * Focus: the `__RT_1025` wire shapes (no job/sex on ADDFRIEND, sex-before-job on
 * REQEST, raw 8-byte Friend struct in the JOIN blob), symmetric insert/delete,
 * and the block-aware visible-state rule from `SendFriendState`.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CPlayer } from '@flyff/entities';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { FriendService } from '../../src/services/friend.service';
import { FRS, FRIEND_ERROR, OFFLINE_ID_OF_MULTI, TID_GAME_MSGINVATECOM } from '../../src/constants/friend';

interface Frame { readonly to: number; readonly buf: Buffer }
interface Row { character_id: number; friend_id: number; blocked: boolean }

function makePlayer(charId: number, over: Partial<CPlayer> = {}): CPlayer {
  const p = Object.create(CPlayer.prototype) as CPlayer;
  p.m_idPlayer = charId;
  p.m_szName = `P${charId}`;
  p.m_nSex = 0;
  p.m_nJob = 1;
  p.m_nDuel = 0;
  p.m_tmLastDamage = 0;
  return Object.assign(p, over);
}

function makeCtx(players: readonly CPlayer[], seed: readonly Row[] = []) {
  const sent: Frame[] = [];
  const rows: Row[] = seed.map((r) => ({ ...r }));
  const states = new Map<number, number>();
  const names = new Map<number, { id: number }>();
  for (const p of players) names.set(p.m_idPlayer, { id: p.m_idPlayer });

  const playerManager = {
    get: (id: number) => players.find((p) => p.m_idPlayer === id),
    sendTo: (p: CPlayer, buf: Buffer) => { sent.push({ to: p.m_idPlayer, buf }); },
  } as unknown as ConstructorParameters<typeof FriendService>[0]['playerManager'];

  const friendRepo = {
    loadByCharacter: async (id: number) => rows.filter((r) => r.character_id === id),
    add: async (a: number, b: number) => {
      for (const [o, f] of [[a, b], [b, a]] as const) {
        if (!rows.some((r) => r.character_id === o && r.friend_id === f)) {
          rows.push({ character_id: o, friend_id: f, blocked: false });
        }
      }
    },
    remove: async (a: number, b: number) => {
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i]!;
        if ((r.character_id === a && r.friend_id === b)
          || (r.character_id === b && r.friend_id === a)) rows.splice(i, 1);
      }
    },
    getState: async (id: number) => states.get(id) ?? FRS.ONLINE,
    setState: async (id: number, s: number) => { states.set(id, s); },
  } as unknown as ConstructorParameters<typeof FriendService>[0]['friendRepo'];

  const charRepo = {
    findByName: async (name: string) => {
      const p = players.find((x) => x.m_szName === name);
      return p ? { id: p.m_idPlayer } : null;
    },
    findById: async (id: number) => names.get(id) ?? null,
  } as unknown as ConstructorParameters<typeof FriendService>[0]['charRepo'];

  const notices: { to: number; tid: number; args?: string }[] = [];
  const svc = new FriendService({
    playerManager, friendRepo, charRepo,
    sendDefinedText: (p, tid, args) => { notices.push({ to: p.m_idPlayer, tid, args }); },
  });
  return { svc, sent, rows, notices, states };
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

/** Raw (non-snapshot) reply: read the leading opcode DWORD. */
function openRaw(buf: Buffer): { opcode: number; r: PacketReader } {
  const r = new PacketReader(buf);
  return { opcode: r.readDword(), r };
}

describe('FriendService', () => {
  describe('invite', () => {
    it('sends REQEST with sex BEFORE job (the __RT_1025 order)', () => {
      const a = makePlayer(1, { m_nSex: 1, m_nJob: 7, m_szName: 'Alice' } as Partial<CPlayer>);
      const b = makePlayer(2);
      const ctx = makeCtx([a, b]);

      assert.deepEqual(ctx.svc.request(a, 2), { ok: true });
      assert.equal(ctx.sent[0]!.to, 2);
      const { objid, subtype, r } = open(ctx.sent[0]!.buf);
      assert.equal(subtype, SNAPSHOTTYPE.ADDFRIEND_SNAPSHOT_REQEST);
      assert.equal(objid, 2);                 // recipient's own objid
      assert.equal(r.readDword(), 1);         // uLeader
      assert.equal(r.readByte(), 1);          // nSex  <- BYTE, first
      assert.equal(r.readDword(), 7);         // nJob  <- LONG, second
      assert.equal(r.readString(), 'Alice');
      assert.equal(r.remaining, 0);
    });

    it('refuses self, offline target, duel, and an existing friendship', () => {
      const a = makePlayer(1); const b = makePlayer(2);
      const ctx = makeCtx([a, b], [{ character_id: 1, friend_id: 2, blocked: false }]);

      assert.deepEqual(ctx.svc.request(a, 1), { ok: false, reason: 'self' });
      assert.deepEqual(ctx.svc.request(a, 99), { ok: false, reason: 'not-online' });
      a.m_nDuel = 1;
      assert.deepEqual(ctx.svc.request(a, 2), { ok: false, reason: 'duel' });
      a.m_nDuel = 0;
    });

    it('sends ADDFRIENDERROR(1) when already friends', async () => {
      const a = makePlayer(1); const b = makePlayer(2);
      const ctx = makeCtx([a, b], [{ character_id: 1, friend_id: 2, blocked: false }]);
      await ctx.svc.onJoin(a);
      ctx.sent.length = 0;

      assert.deepEqual(ctx.svc.request(a, 2), { ok: false, reason: 'already-friend' });
      const { subtype, r } = open(ctx.sent[0]!.buf);
      assert.equal(subtype, SNAPSHOTTYPE.ADDFRIENDERROR);
      assert.equal(r.readByte(), FRIEND_ERROR.ALREADY_FRIEND);
    });

    it('sends ADDFRIENDERROR(2) for an unknown name', async () => {
      const a = makePlayer(1);
      const ctx = makeCtx([a]);
      const out = await ctx.svc.requestByName(a, 'Nobody');
      assert.deepEqual(out, { ok: false, reason: 'no-such-name' });
      const { subtype, r } = open(ctx.sent[0]!.buf);
      assert.equal(subtype, SNAPSHOTTYPE.ADDFRIENDERROR);
      assert.equal(r.readByte(), FRIEND_ERROR.NAME_NOT_FOUND);
      assert.equal(r.readString(), 'Nobody');
    });

    it('refuses a target damaged in the last 10s', () => {
      const a = makePlayer(1);
      const b = makePlayer(2, { m_tmLastDamage: Date.now() - 3_000 } as Partial<CPlayer>);
      const ctx = makeCtx([a, b]);
      assert.deepEqual(ctx.svc.request(a, 2), { ok: false, reason: 'target-in-combat' });
      assert.equal(ctx.notices.length, 1);
    });
  });

  describe('accept', () => {
    it('inserts BOTH directions and sends each side the OTHER name', async () => {
      const a = makePlayer(1, { m_szName: 'Alice' } as Partial<CPlayer>);
      const b = makePlayer(2, { m_szName: 'Bob' } as Partial<CPlayer>);
      const ctx = makeCtx([a, b]);
      await ctx.svc.onJoin(a); await ctx.svc.onJoin(b);
      ctx.sent.length = 0;

      // b accepts a's invite.
      assert.deepEqual(await ctx.svc.accept(b, 1), { ok: true });
      assert.deepEqual(ctx.rows.map((r) => [r.character_id, r.friend_id]), [[1, 2], [2, 1]]);

      const toA = open(ctx.sent.find((f) => f.to === 1)!.buf);
      const toB = open(ctx.sent.find((f) => f.to === 2)!.buf);
      assert.equal(toA.subtype, SNAPSHOTTYPE.ADDFRIEND);
      assert.equal(toA.r.readDword(), 2);
      assert.equal(toA.r.readString(), 'Bob');       // A learns about B
      assert.equal(toB.r.readDword(), 1);
      assert.equal(toB.r.readString(), 'Alice');     // and vice versa
      // No job/sex under __RT_1025.
      assert.equal(toA.r.remaining, 0);
    });

    it('notifies BOTH sides with TID_GAME_MSGINVATECOM + the other name', async () => {
      const a = makePlayer(1, { m_szName: 'Alice' } as Partial<CPlayer>);
      const b = makePlayer(2, { m_szName: 'Bob' } as Partial<CPlayer>);
      const ctx = makeCtx([a, b]);
      await ctx.svc.onJoin(a); await ctx.svc.onJoin(b);
      ctx.notices.length = 0;

      await ctx.svc.accept(b, 1);
      assert.deepEqual(ctx.notices, [
        { to: 1, tid: TID_GAME_MSGINVATECOM, args: 'Bob' },
        { to: 2, tid: TID_GAME_MSGINVATECOM, args: 'Alice' },
      ]);
    });

    it('is idempotent -- a duplicate accept does not double-insert', async () => {      const a = makePlayer(1); const b = makePlayer(2);
      const ctx = makeCtx([a, b]);
      await ctx.svc.onJoin(a); await ctx.svc.onJoin(b);
      await ctx.svc.accept(b, 1);
      assert.deepEqual(await ctx.svc.accept(b, 1), { ok: false, reason: 'already-friend' });
      assert.equal(ctx.rows.length, 2);
    });
  });

  describe('remove', () => {
    it('deletes BOTH directions and pushes REMOVEFRIENDSTATE to the other side', async () => {
      const a = makePlayer(1); const b = makePlayer(2);
      const ctx = makeCtx([a, b], [
        { character_id: 1, friend_id: 2, blocked: false },
        { character_id: 2, friend_id: 1, blocked: false },
      ]);
      await ctx.svc.onJoin(a); await ctx.svc.onJoin(b);
      ctx.sent.length = 0;

      assert.deepEqual(await ctx.svc.remove(a, 2), { ok: true });
      assert.equal(ctx.rows.length, 0);

      const toSelf = open(ctx.sent.find((f) => f.to === 1)!.buf);
      assert.equal(toSelf.subtype, SNAPSHOTTYPE.REMOVEFRIEND_SNAPSHOT);
      assert.equal(toSelf.r.readDword(), 2);

      const toOther = openRaw(ctx.sent.find((f) => f.to === 2)!.buf);
      assert.equal(toOther.opcode, PACKETTYPE.REMOVEFRIENDSTATE);
      assert.equal(toOther.r.readDword(), 1);        // the remover's id
    });

    it('refuses removing a non-friend', async () => {
      const a = makePlayer(1);
      const ctx = makeCtx([a]);
      await ctx.svc.onJoin(a);
      assert.deepEqual(await ctx.svc.remove(a, 99), { ok: false, reason: 'not-friend' });
    });
  });

  describe('JOIN blob (CRTMessenger::Serialize)', () => {
    it('writes own state, count, then id + raw 8-byte Friend per entry', async () => {
      const a = makePlayer(1); const b = makePlayer(2); const c = makePlayer(3);
      const ctx = makeCtx([a, b, c], [
        // Deliberately out of order -- the C++ map iterates ascending.
        { character_id: 1, friend_id: 3, blocked: true },
        { character_id: 1, friend_id: 2, blocked: false },
      ]);
      await ctx.svc.onJoin(a);

      const frame = ctx.sent.find((f) => f.to === 1
        && open(f.buf).subtype === SNAPSHOTTYPE.ADDFRIENDGAMEJOIN)!;
      const { r } = open(frame.buf);
      assert.equal(r.readDword(), FRS.ONLINE);   // m_dwState (owner's own)
      assert.equal(r.readDword(), 2);            // static_cast<int>(size())

      assert.equal(r.readDword(), 2);            // ascending: friend 2 first
      assert.equal(r.readDword(), 0);            // BOOL bBlock (4 bytes)
      assert.equal(r.readDword(), FRS.ONLINE);   // DWORD dwState (b is online)

      assert.equal(r.readDword(), 3);
      assert.equal(r.readDword(), 1);            // blocked
      assert.equal(r.readDword(), FRS.ONLINE);
      assert.equal(r.remaining, 0);
    });

    it('reports an offline friend as FRS_OFFLINE', async () => {
      const a = makePlayer(1);
      const ctx = makeCtx([a], [{ character_id: 1, friend_id: 9, blocked: false }]);
      await ctx.svc.onJoin(a);
      const { r } = open(ctx.sent[0]!.buf);
      r.readDword(); r.readDword(); r.readDword(); r.readDword();
      assert.equal(r.readDword(), FRS.OFFLINE);
    });

    it('pushes ADDFRIENDJOIN to each online friend', async () => {
      const a = makePlayer(1); const b = makePlayer(2);
      const ctx = makeCtx([a, b], [
        { character_id: 1, friend_id: 2, blocked: false },
        { character_id: 2, friend_id: 1, blocked: false },
      ]);
      await ctx.svc.onJoin(b);          // b online first, roster hydrated
      ctx.sent.length = 0;
      await ctx.svc.onJoin(a);

      const toB = ctx.sent.find((f) => f.to === 2)!;
      const { opcode, r } = openRaw(toB.buf);
      assert.equal(opcode, PACKETTYPE.ADDFRIENDJOIN);
      assert.equal(r.readDword(), 1);            // who joined
      assert.equal(r.readDword(), FRS.ONLINE);
    });

    it('pushes ADDFRIENDLOGOUT on disconnect', async () => {
      const a = makePlayer(1); const b = makePlayer(2);
      const ctx = makeCtx([a, b], [
        { character_id: 1, friend_id: 2, blocked: false },
        { character_id: 2, friend_id: 1, blocked: false },
      ]);
      await ctx.svc.onJoin(a); await ctx.svc.onJoin(b);
      ctx.sent.length = 0;

      ctx.svc.onDisconnect(1);
      const toB = ctx.sent.find((f) => f.to === 2)!;
      const { opcode, r } = openRaw(toB.buf);
      assert.equal(opcode, PACKETTYPE.ADDFRIENDLOGOUT);
      assert.equal(r.readDword(), 1);
    });
  });

  describe('state', () => {
    it('GETFRIENDSTATE lists non-blocked first, then blocked', async () => {
      const a = makePlayer(1); const b = makePlayer(2);
      const ctx = makeCtx([a, b], [
        { character_id: 1, friend_id: 2, blocked: false },
        { character_id: 1, friend_id: 7, blocked: true },
      ]);
      await ctx.svc.onJoin(a);
      ctx.sent.length = 0;

      ctx.svc.getState(a);
      const { opcode, r } = openRaw(ctx.sent[0]!.buf);
      assert.equal(opcode, PACKETTYPE.GETFRIENDSTATE);
      assert.equal(r.readDword(), 1);            // nFriendCount
      assert.equal(r.readDword(), 1);            // nBlockCount
      assert.equal(r.readDword(), 2);            // friend id
      assert.equal(r.readDword(), FRS.ONLINE);
      assert.equal(r.readDword(), OFFLINE_ID_OF_MULTI);
      assert.equal(r.readDword(), 7);            // blocked id
      assert.equal(r.readDword(), FRS.OFFLINE);  // 7 is not online
    });

    it('a friend who blocked you always reads as FRS_OFFLINE', async () => {
      const a = makePlayer(1); const b = makePlayer(2);
      const ctx = makeCtx([a, b], [
        { character_id: 1, friend_id: 2, blocked: false },
        { character_id: 2, friend_id: 1, blocked: true },   // B blocked A
      ]);
      await ctx.svc.onJoin(a); await ctx.svc.onJoin(b);
      ctx.sent.length = 0;

      ctx.svc.getState(a);
      const { r } = openRaw(ctx.sent[0]!.buf);
      r.readDword(); r.readDword();
      assert.equal(r.readDword(), 2);
      assert.equal(r.readDword(), FRS.OFFLINE);  // online, but blocked us
    });

    it('SETFRIENDSTATE echoes to self and relays to friends', async () => {
      const a = makePlayer(1); const b = makePlayer(2);
      const ctx = makeCtx([a, b], [
        { character_id: 1, friend_id: 2, blocked: false },
        { character_id: 2, friend_id: 1, blocked: false },
      ]);
      await ctx.svc.onJoin(a); await ctx.svc.onJoin(b);
      ctx.sent.length = 0;

      ctx.svc.setState(a, FRS.ABSENT);
      assert.deepEqual(ctx.sent.map((f) => f.to).sort(), [1, 2]);
      const { opcode, r } = openRaw(ctx.sent[0]!.buf);
      assert.equal(opcode, PACKETTYPE.SETFRIENDSTATE);
      assert.equal(r.readDword(), 1);
      assert.equal(r.readDword(), FRS.ABSENT);
    });

    it('FRS_AUTOABSENT is echoed to self but NOT relayed', async () => {
      const a = makePlayer(1); const b = makePlayer(2);
      const ctx = makeCtx([a, b], [
        { character_id: 1, friend_id: 2, blocked: false },
        { character_id: 2, friend_id: 1, blocked: false },
      ]);
      await ctx.svc.onJoin(a); await ctx.svc.onJoin(b);
      ctx.sent.length = 0;

      ctx.svc.setState(a, FRS.AUTOABSENT);
      assert.deepEqual(ctx.sent.map((f) => f.to), [1]);
    });

    it('clamps an out-of-range state to FRS_ONLINE (C++ does not)', async () => {
      const a = makePlayer(1);
      const ctx = makeCtx([a]);
      await ctx.svc.onJoin(a);
      ctx.sent.length = 0;

      ctx.svc.setState(a, 9999);
      const { r } = openRaw(ctx.sent[0]!.buf);
      r.readDword();
      assert.equal(r.readDword(), FRS.ONLINE);
      assert.equal(ctx.states.get(1), FRS.ONLINE);
    });
  });
});

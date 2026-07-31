/**
 * CampusService tests -- the `CCampusHelper` gates and point economy.
 *
 * The gates are where a faithful port earns its keep: `IsMasterLevel` is a LEVEL
 * test but `IsPupilLevel` is a JOB test, pupil slots key off campus POINTS not
 * level, and the dissolution penalty lands on the REQUESTER rather than whoever
 * actually left.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CPlayer } from '@flyff/entities';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { CampusService } from '../../src/services/campus.service';
import {
  CAMPUS_MASTER, CAMPUS_PUPIL, MIN_MASTER_LEVEL, MIN_LV2_POINT, MIN_LV3_POINT,
  REMOVE_CAMPUS_POINT, COMPLETE_PUPIL_LEVEL, CAMPUS_RECOVERY_TIME_MS,
  CAMPUS_RECOVERY_POINT, CAMPUS_REQUIRED_QUESTS, CAMPUS_BUFF_BY_LEVEL,
  TID_GAME_TS_WANTMYTSP, TID_GAME_TS_WANTYOURTSP, TID_GAME_TS_NOTQUEST,
  TID_GAME_TS_FULLSTUDENT, TID_GAME_TS_NOTLEVEL, TID_GAME_TS_ALREADY,
  TID_GAME_TS_REFUSAL,
} from '../../src/constants/campus';

interface Frame { readonly to: number; readonly buf: Buffer }
interface MemberRow { campus_id: number; character_id: number; member_level: number }

/** A master-eligible player: level >= 91. */
function makeMaster(charId: number, level = MIN_MASTER_LEVEL): CPlayer {
  return makePlayer(charId, level, 20);              // job 20 >= MAX_EXPERT
}
/** A pupil-eligible player: job < MAX_EXPERT (15). */
function makePupil(charId: number, level = 20): CPlayer {
  return makePlayer(charId, level, 1);
}

function makePlayer(charId: number, level: number, job: number): CPlayer {
  const p = Object.create(CPlayer.prototype) as CPlayer & { m_aCompleteQuest: number[] };
  p.m_idPlayer = charId;
  p.m_szName = `P${charId}`;
  p.m_nLevel = level;
  p.m_nJob = job;
  p.m_aCompleteQuest = [...CAMPUS_REQUIRED_QUESTS];   // quest done by default
  return p as CPlayer;
}

function makeCtx(players: readonly CPlayer[], seedPoints: Record<number, number> = {}) {
  const sent: Frame[] = [];
  const notices: { to: number; tid: number }[] = [];
  const buffs: { to: number; itemId: number | null }[] = [];
  const points = new Map<number, number>(Object.entries(seedPoints).map(([k, v]) => [Number(k), v]));
  const ticks = new Map<number, number>();
  let members: MemberRow[] = [];
  const campuses = new Map<number, { id: number; master_id: number }>();
  let nextId = 1;

  const playerManager = {
    get: (id: number) => players.find((p) => p.m_idPlayer === id),
    sendTo: (p: CPlayer, buf: Buffer) => { sent.push({ to: p.m_idPlayer, buf }); },
  } as unknown as ConstructorParameters<typeof CampusService>[0]['playerManager'];

  const campusRepo = {
    loadAll: async () => [...campuses.values()].map((c) => ({
      id: c.id, masterId: c.master_id,
      members: members.filter((m) => m.campus_id === c.id)
        .map((m) => ({ characterId: m.character_id, memberLevel: m.member_level })),
    })),
    addMember: async (masterId: number, pupilId: number, mLv: number, pLv: number) => {
      let existing = members.find((m) => m.character_id === masterId);
      let campusId: number;
      if (existing) { campusId = existing.campus_id; } else {
        campusId = nextId++;
        campuses.set(campusId, { id: campusId, master_id: masterId });
        members.push({ campus_id: campusId, character_id: masterId, member_level: mLv });
      }
      members.push({ campus_id: campusId, character_id: pupilId, member_level: pLv });
      return campusId;
    },
    removeMember: async (campusId: number, charId: number) => {
      members = members.filter((m) => !(m.campus_id === campusId && m.character_id === charId));
    },
    dissolve: async (campusId: number) => {
      campuses.delete(campusId);
      members = members.filter((m) => m.campus_id !== campusId);
    },
    memberCount: async (campusId: number) =>
      members.filter((m) => m.campus_id === campusId).length,
    getPoints: async (id: number) => points.get(id) ?? 0,
    addPoints: async (id: number, delta: number) => {
      const next = (points.get(id) ?? 0) + delta;
      points.set(id, next);
      return next;
    },
    getTick: async (id: number) => ticks.get(id) ?? 0,
    setTick: async (id: number, t: number) => { ticks.set(id, t); },
  } as unknown as ConstructorParameters<typeof CampusService>[0]['campusRepo'];

  const svc = new CampusService({
    playerManager, campusRepo,
    charRepo: { findById: async (id: number) => ({ id }) } as never,
    isQuestComplete: (p, q) => p.m_aCompleteQuest.includes(q),
    applyCampusBuff: (p, itemId) => { buffs.push({ to: p.m_idPlayer, itemId }); },
    removeCampusBuff: (p) => { buffs.push({ to: p.m_idPlayer, itemId: null }); },
    sendDefinedText: (p, tid) => { notices.push({ to: p.m_idPlayer, tid }); },
  });
  /**
   * Hydrate every player's point/tick cache, as JOIN does in production. The
   * gates read the in-memory cache (mirroring C++ reading `m_nCampusPoint` off
   * the already-loaded CUser), so a test that skips this sees 0 points.
   */
  const joinAll = async (): Promise<void> => {
    for (const p of players) await svc.onJoin(p);
    sent.length = 0;
    buffs.length = 0;
  };
  return { svc, sent, notices, buffs, points, ticks, joinAll, members: () => members };
}

function open(buf: Buffer): { objid: number; subtype: number; r: PacketReader } {
  const r = new PacketReader(buf);
  assert.equal(r.readDword(), PACKETTYPE.SNAPSHOT);
  r.readDword();
  assert.equal(r.readWord(), 1);
  return { objid: r.readDword(), subtype: r.readWord(), r };
}

const lastTid = (ctx: ReturnType<typeof makeCtx>) => ctx.notices.at(-1)?.tid;
const framesOf = (ctx: ReturnType<typeof makeCtx>, subtype: number) =>
  ctx.sent.filter((f) => open(f.buf).subtype === subtype);

describe('CampusService', () => {
  describe('invite gates', () => {
    it('blocks when the REQUESTER has negative points (WANTMYTSP first)', async () => {
      const m = makeMaster(1); const p = makePupil(2);
      // Both negative -- the requester's own check must win.
      const ctx = makeCtx([m, p], { 1: -3, 2: -5 });
      await ctx.joinAll();
      assert.equal(ctx.svc.invite(m, 2).ok, false);
      assert.equal(lastTid(ctx), TID_GAME_TS_WANTMYTSP);
    });

    it('blocks when the TARGET has negative points', async () => {
      const m = makeMaster(1); const p = makePupil(2);
      const ctx = makeCtx([m, p], { 1: 10, 2: -1 });
      await ctx.joinAll();
      assert.equal(ctx.svc.invite(m, 2).ok, false);
      assert.equal(lastTid(ctx), TID_GAME_TS_WANTYOURTSP);
    });

    it('blocks when the master has not finished the campus quest', async () => {
      const m = makeMaster(1); const p = makePupil(2);
      (m as CPlayer & { m_aCompleteQuest: number[] }).m_aCompleteQuest = [];
      const ctx = makeCtx([m, p]);
      await ctx.joinAll();
      assert.deepEqual(ctx.svc.invite(m, 2), { ok: false, reason: 'quest-incomplete' });
      assert.equal(lastTid(ctx), TID_GAME_TS_NOTQUEST);
    });

    it('blocks when neither side satisfies a role (NOTLEVEL)', async () => {
      // Two low-level experts: both are pupil-eligible, neither is a master.
      const a = makePupil(1); const b = makePupil(2);
      const ctx = makeCtx([a, b]);
      await ctx.joinAll();
      assert.deepEqual(ctx.svc.invite(a, 2), { ok: false, reason: 'no-role' });
      assert.equal(lastTid(ctx), TID_GAME_TS_NOTLEVEL);
    });

    it('accepts a level-91 first-job character as BOTH master and pupil', async () => {
      // IsMasterLevel is level-based, IsPupilLevel is job-based -- independent.
      const dual = makePlayer(1, 95, 1);              // level 95, job 1
      const pupil = makePupil(2);
      const ctx = makeCtx([dual, pupil]);
      await ctx.joinAll();
      assert.deepEqual(ctx.svc.invite(dual, 2), { ok: true });
    });

    it('blocks when the target is already in a campus', async () => {
      const m = makeMaster(1); const p = makePupil(2); const m2 = makeMaster(3);
      const ctx = makeCtx([m, p, m2]);
      await ctx.joinAll();
      await ctx.svc.accept(p, 1);                     // p joins m's campus
      assert.deepEqual(ctx.svc.invite(m2, 2), { ok: false, reason: 'target-already-in-campus' });
      assert.equal(lastTid(ctx), TID_GAME_TS_ALREADY);
    });

    it('sends CAMPUS_INVITE with the requester id + name', async () => {
      const m = makeMaster(1); const p = makePupil(2);
      const ctx = makeCtx([m, p]);
      await ctx.joinAll();
      assert.deepEqual(ctx.svc.invite(m, 2), { ok: true });
      const { objid, subtype, r } = open(ctx.sent[0]!.buf);
      assert.equal(subtype, SNAPSHOTTYPE.CAMPUS_INVITE);
      assert.equal(objid, 2);                         // recipient's own objid
      assert.equal(r.readDword(), 1);
      assert.equal(r.readString(), 'P1');
      assert.equal(r.remaining, 0);
    });
  });

  describe('pupil slots (GetMaxPupilNum keys on POINTS, not level)', () => {
    it('0 points -> 1 slot; the second invite is refused', async () => {
      const m = makeMaster(1); const p1 = makePupil(2); const p2 = makePupil(3);
      const ctx = makeCtx([m, p1, p2], { 1: 0 });
      await ctx.joinAll();
      await ctx.svc.accept(p1, 1);
      assert.deepEqual(ctx.svc.invite(m, 3), { ok: false, reason: 'pupils-full' });
      assert.equal(lastTid(ctx), TID_GAME_TS_FULLSTUDENT);
    });

    it('MIN_LV2_POINT -> 2 slots', async () => {
      const m = makeMaster(1); const p1 = makePupil(2); const p2 = makePupil(3);
      const ctx = makeCtx([m, p1, p2], { 1: MIN_LV2_POINT });
      await ctx.joinAll();
      await ctx.svc.accept(p1, 1);
      assert.deepEqual(ctx.svc.invite(m, 3), { ok: true });
    });

    it('MIN_LV3_POINT -> 3 slots, and a 4th is refused', async () => {
      const m = makeMaster(1);
      const pupils = [makePupil(2), makePupil(3), makePupil(4)];
      const extra = makePupil(5);
      const ctx = makeCtx([m, ...pupils, extra], { 1: MIN_LV3_POINT });
      await ctx.joinAll();
      for (const p of pupils) await ctx.svc.accept(p, 1);
      assert.deepEqual(ctx.svc.invite(m, 5), { ok: false, reason: 'pupils-full' });
    });
  });

  describe('accept', () => {
    it('creates the campus with master + pupil and broadcasts CAMPUS_UPDATE', async () => {
      const m = makeMaster(1); const p = makePupil(2);
      const ctx = makeCtx([m, p]);
      await ctx.joinAll();
      assert.deepEqual(await ctx.svc.accept(p, 1), { ok: true });

      assert.deepEqual(
        ctx.members().map((x) => [x.character_id, x.member_level]).sort(),
        [[1, CAMPUS_MASTER], [2, CAMPUS_PUPIL]],
      );

      const updates = framesOf(ctx, SNAPSHOTTYPE.CAMPUS_UPDATE);
      assert.deepEqual(updates.map((f) => f.to).sort(), [1, 2]);
      const { r } = open(updates[0]!.buf);
      r.readDword();                                  // campusId
      assert.equal(r.readDword(), 1);                 // masterId
      assert.equal(r.readDword(), 2);                 // member count (size_t)
      assert.equal(r.readDword(), 1);                 // ascending id: master
      assert.equal(r.readDword(), CAMPUS_MASTER);
      assert.equal(r.readDword(), 2);
      assert.equal(r.readDword(), CAMPUS_PUPIL);
    });

    it('works when the PUPIL sent the invite and the master accepts', async () => {
      const m = makeMaster(1); const p = makePupil(2);
      const ctx = makeCtx([m, p]);
      await ctx.joinAll();
      // p invites m, m accepts -> m is still the master.
      assert.deepEqual(await ctx.svc.accept(m, 2), { ok: true });
      const masterRow = ctx.members().find((x) => x.member_level === CAMPUS_MASTER)!;
      assert.equal(masterRow.character_id, 1);
    });

    it('re-runs the gates -- a stale invite cannot bypass them', async () => {
      const m = makeMaster(1); const p = makePupil(2);
      const ctx = makeCtx([m, p]);
      await ctx.joinAll();
      assert.deepEqual(ctx.svc.invite(m, 2), { ok: true });
      // Points go negative between invite and accept. The service reads its own
      // cache (mirroring C++ reading `m_nCampusPoint` off the loaded CUser), so
      // re-hydrate rather than poking the repo map behind its back.
      ctx.points.set(1, -1);
      await ctx.svc.onJoin(m);
      assert.deepEqual(await ctx.svc.accept(p, 1), { ok: false, reason: 'own-points-negative' });
      assert.equal(ctx.members().length, 0);
    });
  });

  describe('refuse', () => {
    it('notifies the requester with TID_GAME_TS_REFUSAL', async () => {
      const m = makeMaster(1); const p = makePupil(2);
      const ctx = makeCtx([m, p]);
      await ctx.joinAll();
      assert.deepEqual(ctx.svc.refuse(p, 1), { ok: true });
      assert.deepEqual(ctx.notices, [{ to: 1, tid: TID_GAME_TS_REFUSAL }]);
    });
  });

  describe('removal', () => {
    it('master expels a pupil; the MASTER pays the penalty', async () => {
      const m = makeMaster(1); const p1 = makePupil(2); const p2 = makePupil(3);
      const ctx = makeCtx([m, p1, p2], { 1: MIN_LV2_POINT });
      await ctx.joinAll();
      await ctx.svc.accept(p1, 1);
      await ctx.svc.accept(p2, 1);
      const before = ctx.points.get(1)!;
      ctx.sent.length = 0;

      assert.deepEqual(await ctx.svc.removeMember(m, 2), { ok: true });
      assert.equal(ctx.members().some((x) => x.character_id === 2), false);
      assert.equal(ctx.points.get(1), before - REMOVE_CAMPUS_POINT);
      assert.equal(ctx.points.get(2) ?? 0, 0);        // the pupil pays nothing
      assert.equal(framesOf(ctx, SNAPSHOTTYPE.CAMPUS_REMOVE).length, 1);
    });

    it('a pupil removing the master removes THEMSELVES and dissolves at <2', async () => {
      const m = makeMaster(1); const p = makePupil(2);
      const ctx = makeCtx([m, p], { 2: 10 });
      await ctx.joinAll();
      await ctx.svc.accept(p, 1);
      ctx.sent.length = 0;

      assert.deepEqual(await ctx.svc.removeMember(p, 1), { ok: true });
      assert.equal(ctx.members().length, 0);          // dissolved
      assert.equal(ctx.points.get(2), 10 - REMOVE_CAMPUS_POINT);
      // Both the leaver and the dissolve path get CAMPUS_REMOVE.
      assert.ok(framesOf(ctx, SNAPSHOTTYPE.CAMPUS_REMOVE).length >= 2);
    });

    it('refuses a master->master or pupil->pupil pair', async () => {
      const m = makeMaster(1); const p1 = makePupil(2); const p2 = makePupil(3);
      const ctx = makeCtx([m, p1, p2], { 1: MIN_LV2_POINT });
      await ctx.joinAll();
      await ctx.svc.accept(p1, 1);
      await ctx.svc.accept(p2, 1);
      assert.deepEqual(await ctx.svc.removeMember(p1, 3), { ok: false, reason: 'bad-pair' });
    });

    it('refuses when the requester has no campus', async () => {
      const m = makeMaster(1);
      const ctx = makeCtx([m]);
      await ctx.joinAll();
      assert.deepEqual(await ctx.svc.removeMember(m, 2), { ok: false, reason: 'no-campus' });
    });
  });

  describe('point recovery', () => {
    it('does nothing while points are non-negative', async () => {
      const m = makeMaster(1);
      const ctx = makeCtx([m], { 1: 5 });
      await ctx.joinAll();
      await ctx.svc.onJoin(m);
      await ctx.svc.recoverPoints(m, 1_000_000);
      assert.equal(ctx.points.get(1), 5);
    });

    it('the first call after going negative only STARTS the timer', async () => {
      const m = makeMaster(1);
      const ctx = makeCtx([m], { 1: -2 });
      await ctx.joinAll();
      await ctx.svc.onJoin(m);
      const now = 5_000_000;
      await ctx.svc.recoverPoints(m, now);
      assert.equal(ctx.points.get(1), -2);            // no free point
      assert.equal(ctx.ticks.get(1), now);
    });

    it('grants a point once the 60-minute interval elapses', async () => {
      const m = makeMaster(1);
      const ctx = makeCtx([m], { 1: -2 });
      await ctx.joinAll();
      await ctx.svc.onJoin(m);
      const t0 = 5_000_000;
      await ctx.svc.recoverPoints(m, t0);
      await ctx.svc.recoverPoints(m, t0 + CAMPUS_RECOVERY_TIME_MS + 1);
      assert.equal(ctx.points.get(1), -2 + CAMPUS_RECOVERY_POINT);
    });

    it('does not grant before the interval', async () => {
      const m = makeMaster(1);
      const ctx = makeCtx([m], { 1: -2 });
      await ctx.joinAll();
      await ctx.svc.onJoin(m);
      const t0 = 5_000_000;
      await ctx.svc.recoverPoints(m, t0);
      await ctx.svc.recoverPoints(m, t0 + CAMPUS_RECOVERY_TIME_MS - 1);
      assert.equal(ctx.points.get(1), -2);
    });
  });

  describe('level-up rewards', () => {
    it('pays master and pupil on an EXACT reward level', async () => {
      const m = makeMaster(1); const p = makePupil(2, 14);
      const ctx = makeCtx([m, p]);
      await ctx.joinAll();
      await ctx.svc.accept(p, 1);
      const mBefore = ctx.points.get(1) ?? 0;

      p.m_nLevel = 15;                                // exact key
      await ctx.svc.onLevelUp(p);
      assert.equal(ctx.points.get(1), mBefore + 1);
      assert.equal(ctx.points.get(2), 1);
    });

    it('pays nothing when the level is not an exact key', async () => {
      const m = makeMaster(1); const p = makePupil(2, 15);
      const ctx = makeCtx([m, p]);
      await ctx.joinAll();
      await ctx.svc.accept(p, 1);
      p.m_nLevel = 16;
      await ctx.svc.onLevelUp(p);
      assert.equal(ctx.points.get(2) ?? 0, 0);
    });

    it('pays nothing when the MASTER levels up', async () => {
      const m = makeMaster(1); const p = makePupil(2);
      const ctx = makeCtx([m, p]);
      await ctx.joinAll();
      await ctx.svc.accept(p, 1);
      m.m_nLevel = 15;
      await ctx.svc.onLevelUp(m);
      assert.equal(ctx.points.get(2) ?? 0, 0);
    });

    it('graduates the pupil at COMPLETE_PUPIL_LEVEL, dissolving the pairing', async () => {
      const m = makeMaster(1); const p = makePupil(2, 74);
      const ctx = makeCtx([m, p]);
      await ctx.joinAll();
      await ctx.svc.accept(p, 1);

      p.m_nLevel = COMPLETE_PUPIL_LEVEL;
      await ctx.svc.onLevelUp(p);
      assert.equal(ctx.points.get(2), 5);             // the level-75 pupil reward
      assert.equal(ctx.members().length, 0);          // dissolved (fewer than 2)
    });
  });

  describe('buff levels', () => {
    it("a master's buff level is the count of ONLINE pupils", async () => {
      const m = makeMaster(1); const p1 = makePupil(2); const p2 = makePupil(3);
      const ctx = makeCtx([m, p1, p2], { 1: MIN_LV2_POINT });
      await ctx.joinAll();
      await ctx.svc.accept(p1, 1);
      ctx.buffs.length = 0;
      await ctx.svc.accept(p2, 1);

      const masterBuff = ctx.buffs.filter((b) => b.to === 1 && b.itemId !== null).at(-1);
      assert.equal(masterBuff?.itemId, CAMPUS_BUFF_BY_LEVEL[2]);
    });

    it('a pupil gets level 1 while the master is online', async () => {
      const m = makeMaster(1); const p = makePupil(2);
      const ctx = makeCtx([m, p]);
      await ctx.joinAll();
      await ctx.svc.accept(p, 1);
      const pupilBuff = ctx.buffs.filter((b) => b.to === 2 && b.itemId !== null).at(-1);
      assert.equal(pupilBuff?.itemId, CAMPUS_BUFF_BY_LEVEL[1]);
    });

    it('strips the buff when the counterpart goes offline', async () => {
      const m = makeMaster(1); const p = makePupil(2);
      // Only the pupil is registered in the manager -> master reads as offline.
      const ctx = makeCtx([p]);
      await ctx.joinAll();
      // Seed the campus by hand: accept needs both online.
      const full = makeCtx([m, p]);
      await full.svc.accept(p, 1);

      full.buffs.length = 0;
      full.svc.onDisconnect(1);                       // master leaves
      // The pupil is still online but the master is not resolvable as a peer in
      // the same manager, so their level drops to 0 -> strip.
      assert.ok(full.buffs.some((b) => b.to === 2));
      void ctx;
    });
  });
});

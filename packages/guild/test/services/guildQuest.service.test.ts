/**
 * GuildQuestService tests -- the start gates (including the two divergences from
 * C++), the boss-death transition, the two-phase tick, and ejection.
 *
 * The geometry is the shipped `QUEST_WARMON_LV1` data, so the entry drop point
 * and the rect membership assertions are real numbers rather than round ones.
 *
 * @module services/guildQuest.service.test
 */

import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import type { CPlayer } from '@flyff/entities';
import { GuildManager } from '../../src/managers/guild.manager';
import {
  GuildQuestProcessor, GQP_WORMON, GQP_GETITEM,
  GUILD_QUEST_WORMON_MS, GUILD_QUEST_GETITEM_MS,
  type GuildQuestPropLike,
} from '../../src/managers/guildQuest.manager';
import { GuildQuestService, GUILD_QUEST_MIN_LEVEL } from '../../src/services/guildQuest.service';

const WARMON: GuildQuestPropLike = {
  id: 1, worldId: 1, wormonId: 20,
  pos: { x: 3892.785, y: 78.038, z: 3960.506 },
  rect: { left: 3787, top: 3843, right: 4000, bottom: 4064 },
};

/** Inside the shipped rect. */
const IN = { x: 3892, y: 78, z: 3960 };
/** Far outside it. */
const OUT = { x: 0, y: 0, z: 0 };
const REVIVAL = { x: 6000, y: 100, z: 6000 };

interface MockPlayer {
  m_idPlayer: number;
  m_szName: string;
  m_nLevel: number;
  m_nZoneId: number;
  m_vPos: { x: number; y: number; z: number };
  m_bDead: boolean;
}

function makePlayer(id: number, over: Partial<MockPlayer> = {}): MockPlayer & CPlayer {
  return {
    m_idPlayer: id, m_szName: `P${id}`,
    m_nLevel: GUILD_QUEST_MIN_LEVEL, m_nZoneId: 1,
    m_vPos: { ...OUT }, m_bDead: false,
    ...over,
  } as MockPlayer & CPlayer;
}

function makeHarness() {
  const players = new Map<number, CPlayer>();
  const sent: Array<{ id: number; buf: Buffer }> = [];
  const spawned: Array<{ moverId: number; pos: { x: number; y: number; z: number }; zoneId: number; activeAttack: boolean | undefined }> = [];
  const killed: number[] = [];
  const teleports: Array<{ id: number; pos: { x: number; y: number; z: number } }> = [];
  let nextObjid = 0x40000001;

  const playerManager = {
    get: (id: number) => players.get(id),
    sendTo: (p: CPlayer, buf: Buffer) => { sent.push({ id: p.m_idPlayer, buf }); },
  };
  const spawn = {
    spawnMonster: (
      moverId: number, pos: { x: number; y: number; z: number },
      zoneId: number, activeAttack?: boolean,
    ) => {
      spawned.push({ moverId, pos, zoneId, activeAttack });
      return { m_idMover: nextObjid++ };
    },
    kill: (id: number) => { killed.push(id); return true; },
  };
  const teleport = {
    teleport: (p: CPlayer, pos: { x: number; y: number; z: number }) => {
      p.m_vPos = { ...pos };
      teleports.push({ id: p.m_idPlayer, pos });
    },
    revivalPos: () => REVIVAL,
  };
  return { players, sent, spawned, killed, teleports, playerManager, spawn, teleport };
}

describe('GuildQuestService', () => {
  let h: ReturnType<typeof makeHarness>;
  let guilds: GuildManager;
  let processor: GuildQuestProcessor;
  let service: GuildQuestService;
  let clock: number;
  let flag: boolean;

  /** Guild A: master 1, members 2-4. Guild B: master 100, members 101-102. */
  let ma: MockPlayer & CPlayer;
  let mb: MockPlayer & CPlayer;
  let ga: number;
  let gb: number;

  beforeEach(() => {
    h = makeHarness();
    guilds = new GuildManager();
    clock = 1_000_000;
    flag = true;
    processor = new GuildQuestProcessor([WARMON], () => clock);
    service = new GuildQuestService({
      playerManager: h.playerManager as never,
      guildManager: guilds,
      processor,
      spawn: h.spawn,
      teleport: h.teleport,
      isQuestEnabled: () => flag,
      now: () => clock,
    });

    ma = makePlayer(1); mb = makePlayer(100);
    h.players.set(1, ma); h.players.set(100, mb);
    ga = guilds.create('Alpha', 1, [2, 3, 4])!.id;
    gb = guilds.create('Beta', 100, [101, 102])!.id;
    for (const id of [2, 3, 4, 101, 102]) h.players.set(id, makePlayer(id));
  });

  // ── start ─────────────────────────────────────────────────────────────────

  describe('start gates', () => {
    it('refuses a guildless player', () => {
      const loner = makePlayer(500);
      assert.deepEqual(service.start(loner, 1, 0, 14, 1), { ok: false, reason: 'no-guild' });
      assert.equal(h.spawned.length, 0);
    });

    /**
     * DIVERGENCE D7. `MonHuntStart` checks only "not already questing / has a
     * guild / prop exists" (`ScriptLib.cpp:446-457`) -- there is NO master check.
     * Every real gate lives in the dialog script (`NpcScript.cpp:1977`), which is
     * a client-visible branch rather than an authority check, so without this a
     * crafted or mis-authored dialog step lets any member seize the arena.
     */
    it('refuses a plain MEMBER even at the required level -- divergence D7', () => {
      const member = h.players.get(2)!;
      assert.deepEqual(service.start(member, 1, 0, 14, 1), { ok: false, reason: 'not-master' });
      assert.equal(h.spawned.length, 0, 'nothing spawned');
      assert.equal(processor.isQuesting(1), false);
    });

    /** Same divergence, other half: the level-70 literal from the script. */
    it('refuses a MASTER below level 70 -- divergence D7', () => {
      ma.m_nLevel = GUILD_QUEST_MIN_LEVEL - 1;
      assert.deepEqual(service.start(ma, 1, 0, 14, 1), { ok: false, reason: 'level' });
      ma.m_nLevel = GUILD_QUEST_MIN_LEVEL;
      assert.equal(service.start(ma, 1, 0, 14, 1).ok, true, 'exactly 70 passes');
    });

    it('refuses when the quest id is already held -- world-exclusive', () => {
      assert.equal(service.start(ma, 1, 0, 14, 1).ok, true);
      // A DIFFERENT guild's master, on a quest another guild opened.
      assert.deepEqual(service.start(mb, 1, 0, 14, 1), { ok: false, reason: 'already-questing' });
    });

    it('refuses an unknown quest id', () => {
      assert.deepEqual(service.start(ma, 99, 0, 14, 1), { ok: false, reason: 'no-prop' });
      assert.equal(h.spawned.length, 0, 'the prop check precedes the spawn');
    });

    it('refuses when the spawn fails', () => {
      const svc = new GuildQuestService({
        playerManager: h.playerManager as never,
        guildManager: guilds, processor,
        spawn: { spawnMonster: () => undefined, kill: h.spawn.kill },
        teleport: h.teleport,
        isQuestEnabled: () => flag,
        now: () => clock,
      });
      assert.deepEqual(svc.start(ma, 1, 0, 14, 1), { ok: false, reason: 'spawn-failed' });
      assert.equal(processor.isQuesting(1), false, 'no arena left half-open');
    });
  });

  describe('start success', () => {
    it('spawns the prop boss, active-attacking, at the prop position', () => {
      const res = service.start(ma, 1, 0, 14, 1);
      assert.ok(res.ok);
      assert.equal(h.spawned.length, 1);
      assert.equal(h.spawned[0]?.moverId, WARMON.wormonId);
      assert.deepEqual(h.spawned[0]?.pos, WARMON.pos);
      assert.equal(h.spawned[0]?.zoneId, 1);
      assert.equal(h.spawned[0]?.activeAttack, true);
      assert.equal(res.bossObjid, 0x40000001);
      assert.equal(processor.get(1)?.bossObjid, res.bossObjid);
    });

    it('writes the start state to the ledger and opens the arena', () => {
      assert.equal(service.start(ma, 1, 0, 14, 1).ok, true);
      assert.equal(guilds.getQuest(ga, 1)?.state, 0);
      const e = processor.get(1);
      assert.equal(e?.process, GQP_WORMON);
      assert.equal(e?.guildId, ga);
      assert.equal(e?.endsAt, clock + GUILD_QUEST_WORMON_MS);
    });

    it('sends SETGUILDQUEST to online members only', () => {
      // Member 4 is on the roster but offline.
      h.players.delete(4);
      service.start(ma, 1, 0, 14, 1);
      const snaps = h.sent.filter((s) => s.buf.readUInt32LE(0) === PACKETTYPE.SNAPSHOT
        && s.buf.readUInt16LE(14) === SNAPSHOTTYPE.SETGUILDQUEST);
      assert.equal(snaps.length, 3, 'master + members 2,3 -- not the offline 4');
      const ids = snaps.map((s) => s.id).sort((a, b) => a - b);
      assert.deepEqual(ids, [1, 2, 3]);
      // The objid on the record is the RECIPIENT's own id (`User.cpp:2297`).
      for (const s of snaps) assert.equal(s.buf.readUInt32LE(10), s.id);
      const first = snaps[0]!.buf;
      assert.equal(first.readUInt32LE(16), 1, 'nQuestId');
      assert.equal(first.readUInt32LE(20), 0, 'nState');
    });

    it('pulls the guild to a point a third of the way toward the rect edge', () => {
      // `MonHuntStart`'s tail: `z = ((vPos.z * 2) + prop->y2) / 3`
      // (`ScriptLib.cpp:482`). The file's `y2` is the swapped rect's `top`, so
      // the party lands OFF the boss rather than on top of it.
      const expectedZ = (WARMON.pos.z * 2 + WARMON.rect.top) / 3;
      assert.ok(Math.abs(expectedZ - 3921.337) < 0.01, 'sanity: ~3921.34');
      service.start(ma, 1, 0, 14, 1);
      assert.equal(h.teleports.length, 4, 'master + three members');
      for (const t of h.teleports) {
        assert.equal(t.pos.x, WARMON.pos.x);
        assert.equal(t.pos.y, WARMON.pos.y);
        assert.equal(t.pos.z, expectedZ);
        assert.notEqual(t.pos.z, WARMON.pos.z, 'NOT the boss position');
      }
    });

    it('kills the boss if the arena fails to open after the spawn', () => {
      // The real class cannot be made to fail `open` after `getProp` succeeded,
      // so the failure is injected with a hand-rolled processor satisfying the
      // same surface. The point of the test is the no-orphan-monster guarantee.
      const failing = Object.create(processor) as GuildQuestProcessor;
      failing.open = () => undefined;
      const svc = new GuildQuestService({
        playerManager: h.playerManager as never,
        guildManager: guilds, processor: failing,
        spawn: h.spawn, teleport: h.teleport,
        isQuestEnabled: () => flag, now: () => clock,
      });
      assert.equal(svc.start(ma, 1, 0, 14, 1).ok, false);
      assert.deepEqual(h.killed, [0x40000001], 'the orphan was cleaned up');
    });
  });

  // ── onBossKilled ──────────────────────────────────────────────────────────

  describe('onBossKilled', () => {
    it('ignores an objid that is not a live arena boss', () => {
      service.start(ma, 1, 0, 14, 1);
      assert.equal(service.onBossKilled(0xdeadbeef), false);
      assert.equal(processor.get(1)?.process, GQP_WORMON, 'unchanged');
    });

    it('advances to the loot window and writes the SUCCESS state', () => {
      const res = service.start(ma, 1, 0, 14, 1);
      assert.ok(res.ok);
      clock += 5000;
      assert.equal(service.onBossKilled(res.bossObjid), true);
      const e = processor.get(1);
      assert.equal(e?.process, GQP_GETITEM);
      assert.equal(e?.endsAt, clock + GUILD_QUEST_GETITEM_MS);
      assert.equal(guilds.getQuest(ga, 1)?.state, 14, 'ns written');
    });

    /**
     * DIVERGENCE D6. C++ reads `CGuild* pGuild = pAttacker->GetGuild();`
     * (`Mover.cpp:7499`) and writes the success state to THAT guild, with no
     * comparison against `pElem->idGuild`. Two holes follow: an outside guild
     * that lands the killing blow takes a 60-minute run off the guild that
     * opened the arena, and a guildless killer voids it entirely (the whole
     * `if( pGuild )` block is skipped, stranding the arena in GQP_WORMON with a
     * dangling boss objid until it times out and writes the FAILURE state).
     *
     * We credit `elem.guildId`. The combat hook does not even receive the
     * attacker, so the steal cannot be reintroduced by a one-line edit.
     */
    it('credits the guild that OPENED the arena, whoever killed -- divergence D6', () => {
      const res = service.start(ma, 1, 0, 14, 1);
      assert.ok(res.ok);
      assert.equal(service.onBossKilled(res.bossObjid), true);
      assert.equal(guilds.getQuest(ga, 1)?.state, 14, 'opener credited');
      assert.equal(guilds.getQuest(gb, 1), undefined, 'guild B got nothing');
    });

    it('a second call on the same objid misses -- the objid was cleared', () => {
      const res = service.start(ma, 1, 0, 14, 1);
      assert.ok(res.ok);
      assert.equal(service.onBossKilled(res.bossObjid), true);
      assert.equal(service.onBossKilled(res.bossObjid), false);
    });
  });

  // ── tick ──────────────────────────────────────────────────────────────────

  /** Put the whole of guild A inside the rect so presence scans see them. */
  function gatherInside(): void {
    for (const id of [1, 2, 3, 4]) {
      const p = h.players.get(id);
      if (p) p.m_vPos = { ...IN };
    }
  }

  /** Clear the debounce without tripping any scan outcome. */
  function runDebounce(): void {
    gatherInside();
    for (let i = 0; i < 10; i++) service.tick();
  }

  describe('tick', () => {
    it('is a no-op when the arena flag is off', () => {
      service.start(ma, 1, 0, 14, 1);
      flag = false;
      clock += GUILD_QUEST_WORMON_MS + 1;
      service.tick();
      assert.equal(processor.isQuesting(1), true, 'expired but untouched');
      assert.equal(guilds.getQuest(ga, 1)?.state, 0, 'no failure state written');
    });

    it('GQP_WORMON deadline writes the FAILURE state, kills the boss, closes', () => {
      const res = service.start(ma, 1, 0, 14, 1);
      assert.ok(res.ok);
      h.killed.length = 0;
      clock += GUILD_QUEST_WORMON_MS + 1;
      service.tick();
      assert.equal(guilds.getQuest(ga, 1)?.state, 1, 'nf -- guildquest.cpp:50');
      assert.deepEqual(h.killed, [res.bossObjid]);
      assert.equal(processor.isQuesting(1), false);
    });

    it('GQP_GETITEM deadline closes WITHOUT rewriting the ledger', () => {
      const res = service.start(ma, 1, 0, 14, 1);
      assert.ok(res.ok);
      service.onBossKilled(res.bossObjid);
      assert.equal(guilds.getQuest(ga, 1)?.state, 14);
      h.killed.length = 0;
      clock += GUILD_QUEST_GETITEM_MS + 1;
      service.tick();
      assert.equal(processor.isQuesting(1), false);
      assert.equal(guilds.getQuest(ga, 1)?.state, 14, 'success state survives the close');
      assert.equal(h.killed.length, 0, 'the boss is already gone');
    });

    it('the wipe scan is suppressed for nine ticks, then closes on the tenth', () => {
      // `if( ++pElem->nCount < 10 ) continue;` (`guildquest.cpp:88`) -- it stops
      // the scan firing before the teleported members have arrived.
      service.start(ma, 1, 0, 14, 1);
      // Nobody in the rect: put them all back outside.
      for (const id of [1, 2, 3, 4]) { const p = h.players.get(id); if (p) p.m_vPos = { ...OUT }; }
      for (let i = 0; i < 9; i++) service.tick();
      assert.equal(processor.isQuesting(1), true, 'still open after nine ticks');
      service.tick();
      assert.equal(processor.isQuesting(1), false, 'tenth tick wipes it');
      assert.equal(guilds.getQuest(ga, 1)?.state, 1, 'nf on a wipe');
    });

    it('a live member in the rect keeps GQP_WORMON open past the debounce', () => {
      service.start(ma, 1, 0, 14, 1);
      runDebounce();
      assert.equal(processor.isQuesting(1), true);
      service.tick();
      assert.equal(processor.isQuesting(1), true);
    });

    /**
     * The two presence checks are deliberately asymmetric in the C++: the wipe
     * check ANDs in `pUser->IsLive()` (`guildquest.cpp:106`) while the
     * loot-window check omits it (`:149`). So a corpse does not hold the arena
     * during the fight but does hold it during looting.
     */
    it('a DEAD member does NOT keep GQP_WORMON alive', () => {
      service.start(ma, 1, 0, 14, 1);
      gatherInside();
      for (const id of [1, 2, 3, 4]) { const p = h.players.get(id); if (p) p.m_bDead = true; }
      for (let i = 0; i < 10; i++) service.tick();
      assert.equal(processor.isQuesting(1), false, 'all dead counts as a wipe');
    });

    it('...but a DEAD member DOES keep GQP_GETITEM alive', () => {
      const res = service.start(ma, 1, 0, 14, 1);
      assert.ok(res.ok);
      gatherInside();
      service.onBossKilled(res.bossObjid);
      for (const id of [1, 2, 3, 4]) { const p = h.players.get(id); if (p) p.m_bDead = true; }
      for (let i = 0; i < 12; i++) service.tick();
      assert.equal(processor.isQuesting(1), true, 'the IsLive() term is absent here');
    });

    it('an empty rect closes the loot window from the FIRST tick -- no debounce', () => {
      const res = service.start(ma, 1, 0, 14, 1);
      assert.ok(res.ok);
      service.onBossKilled(res.bossObjid);
      // Everyone is outside (start() teleported them to the drop point, which is
      // inside; move them out).
      for (const id of [1, 2, 3, 4]) { const p = h.players.get(id); if (p) p.m_vPos = { ...OUT }; }
      service.tick();
      assert.equal(processor.isQuesting(1), false);
    });

    it('closing ejects members inside the rect and leaves the rest alone', () => {
      service.start(ma, 1, 0, 14, 1);
      gatherInside();
      const outsider = h.players.get(4)!;
      outsider.m_vPos = { ...OUT };
      h.teleports.length = 0;
      clock += GUILD_QUEST_WORMON_MS + 1;
      service.tick();
      const movedIds = h.teleports.map((t) => t.id).sort((a, b) => a - b);
      assert.deepEqual(movedIds, [1, 2, 3], 'the three inside');
      for (const t of h.teleports) assert.deepEqual(t.pos, REVIVAL);
      assert.deepEqual(outsider.m_vPos, OUT, 'untouched');
    });
  });

  // ── adjustOnEnter ─────────────────────────────────────────────────────────

  describe('adjustOnEnter', () => {
    it('leaves a player outside every rect alone', () => {
      const p = makePlayer(700, { m_vPos: { ...OUT } });
      assert.equal(service.adjustOnEnter(p), false);
      assert.equal(h.teleports.length, 0);
    });

    it('ejects from an unoccupied rect', () => {
      // `!pElem` is one of the two eject conditions (`User.cpp:3659`).
      const p = makePlayer(700, { m_vPos: { ...IN } });
      assert.equal(service.adjustOnEnter(p), true);
      assert.deepEqual(p.m_vPos, REVIVAL);
    });

    it('leaves a member of the OWNING guild in place', () => {
      service.start(ma, 1, 0, 14, 1);
      const member = h.players.get(2)!;
      member.m_vPos = { ...IN };
      h.teleports.length = 0;
      assert.equal(service.adjustOnEnter(member), false);
      assert.equal(h.teleports.length, 0);
    });

    it('ejects a member of a DIFFERENT guild', () => {
      service.start(ma, 1, 0, 14, 1);
      const intruder = h.players.get(101)!;
      intruder.m_vPos = { ...IN };
      assert.equal(service.adjustOnEnter(intruder), true);
      assert.deepEqual(intruder.m_vPos, REVIVAL);
    });

    it('ejects a guildless player', () => {
      service.start(ma, 1, 0, 14, 1);
      const loner = makePlayer(700, { m_vPos: { ...IN } });
      assert.equal(service.adjustOnEnter(loner), true);
      assert.deepEqual(loner.m_vPos, REVIVAL);
    });
  });

  // ── /sgq ──────────────────────────────────────────────────────────────────

  describe('setStateByGuildName (the /sgq admin path)', () => {
    it('rejects an unknown guild name', () => {
      assert.equal(service.setStateByGuildName('Nobody', 1, 14), false);
    });

    it('writes the ledger and opens NO arena', () => {
      // `TextCmd_SetGuildQuest` (`FuncTextCmd.cpp:1257-1286`) calls
      // `pGuild->SetQuest` + `SendUpdateGuildQuest` and stops -- it never touches
      // `CGuildQuestProcessor`, so it spawns no boss and starts no timer. An
      // admin setting state 14 is editing the ledger, not completing a run.
      assert.equal(service.setStateByGuildName('Alpha', 1, 14), true);
      assert.equal(guilds.getQuest(ga, 1)?.state, 14);
      assert.equal(processor.isQuesting(1), false, 'no arena');
      assert.equal(h.spawned.length, 0, 'no boss');
    });

    it('is case-insensitive, like every other guild-name lookup', () => {
      assert.equal(service.setStateByGuildName('alpha', 1, 0), true);
    });
  });

  describe('isQuestRegion', () => {
    it('delegates to the prop scan and ignores live arenas', () => {
      assert.equal(service.isQuestRegion(IN), true, 'true with nothing running');
      assert.equal(service.isQuestRegion(IN, 1), true);
      assert.equal(service.isQuestRegion(IN, 7), false, 'wrong world');
      assert.equal(service.isQuestRegion(OUT), false);
      service.start(ma, 1, 0, 14, 1);
      assert.equal(service.isQuestRegion(IN), true, 'and true with one running');
    });
  });
});

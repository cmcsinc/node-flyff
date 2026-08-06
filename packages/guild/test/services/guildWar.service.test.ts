/**
 * GuildWarService tests -- the declare/accept ladder, the two divergences from
 * C++ (flag-gated declaration, proposal-validated accept), the surrender
 * threshold, the truce handshake, master-death resolution, and the tick.
 *
 * Every gate asserted here is a port of a `CDPCacheSrvr::On*` /
 * `CDPCoreSrvr::On*` refusal branch, so each case checks BOTH the return value
 * and that no packet escaped.
 * @module services/guildWar.service.test
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import {
  NULL_ID, GUD_ROOKIE,
  WR_DECL_GN, WR_ACPT_GN, WR_DECL_SR, WR_ACPT_SR, WR_TRUCE, WR_DRAW,
  GUILD_WAR_MIN_LEVEL, GUILD_WAR_MIN_TARGET_MEMBERS,
  GUILD_WAR_DURATION_MS,
} from '@flyff/world-core';
import type { CPlayer } from '@flyff/entities';
import { GuildManager } from '../../src/managers/guild.manager';
import { GuildWarManager } from '../../src/managers/guildWar.manager';
import { GuildWarService } from '../../src/services/guildWar.service';
import {
  TID_GAME_COMNOHAVECOM, TID_GAME_COMDELNOTKINGPIN,
  TID_GAME_GUILDWARREQLV6, TID_GAME_GUILDWARNOTHINGGUILD,
  TID_GAME_GUILDWAROHTERLV6, TID_GAME_GUILDWARMASTEROFF,
  TID_GAME_GUILDWARMEMBER10, TID_GAME_GUILDWARSTILLNOWAR,
  TID_GAME_GUILDWARNOREQUEST, TID_GAME_GUILDWARNOFINDGUILD,
  TID_GAME_GUILDWARNOETC,
} from '../../src/guildText';

interface MockPlayer {
  m_idPlayer: number;
  m_szName: string;
  m_idGuild: number;
  m_idWar: number;
  m_nZoneId: number;
  m_vPos: { x: number; y: number; z: number };
}

function makePlayer(id: number): MockPlayer & CPlayer {
  return {
    m_idPlayer: id, m_szName: `P${id}`, m_idGuild: NULL_ID, m_idWar: 0,
    m_nZoneId: 1, m_vPos: { x: 0, y: 0, z: 0 },
  } as MockPlayer & CPlayer;
}

function op(buf: Buffer): number { return buf.readUInt32LE(0); }
function subtype(buf: Buffer): number { return buf.readUInt16LE(14); }

function makeHarness() {
  const players = new Map<number, CPlayer>();
  const sent: Array<{ id: number; buf: Buffer }> = [];
  const broadcasts: Buffer[] = [];
  const around: Buffer[] = [];
  const playerManager = {
    get: (id: number) => players.get(id),
    sendTo: (p: CPlayer, buf: Buffer) => { sent.push({ id: p.m_idPlayer, buf }); },
    broadcastAll: (buf: Buffer) => { broadcasts.push(buf); },
  };
  const zoneManager = {
    broadcastAround: (
      _pos: unknown, _zone: number, _radius: number, buf: Buffer,
    ) => { around.push(buf); },
  };
  return { players, sent, broadcasts, around, playerManager, zoneManager };
}

describe('GuildWarService', () => {
  let harness: ReturnType<typeof makeHarness>;
  let guilds: GuildManager;
  let wars: GuildWarManager;
  let service: GuildWarService;
  let clock: number;
  let flag: boolean;
  /** Refusal notices -- recorded as (recipient, tid) rather than serialized. */
  let notices: Array<{ id: number; tid: number; args: string | undefined }>;

  /** Master ids: guild A = 1, guild B = 100. */
  let ma: MockPlayer & CPlayer;
  let mb: MockPlayer & CPlayer;
  let ga: number;
  let gb: number;

  /**
   * Build two war-eligible guilds: level 6, ten members each, masters online.
   * Those are exactly the three `#ifndef __INTERNALSERVER` declare gates.
   */
  function seedGuilds(): void {
    ma = makePlayer(1); mb = makePlayer(100);
    harness.players.set(1, ma); harness.players.set(100, mb);
    const a = guilds.create('Alpha', 1, [2, 3, 4, 5, 6, 7, 8, 9, 10])!;
    const b = guilds.create('Beta', 100, [101, 102, 103, 104, 105, 106, 107, 108, 109])!;
    ga = a.id; gb = b.id;
    a.level = GUILD_WAR_MIN_LEVEL;
    b.level = GUILD_WAR_MIN_LEVEL;
    ma.m_idGuild = ga; mb.m_idGuild = gb;
    // Put every member online so roster fan-outs are observable.
    for (const id of [2, 3, 4, 5, 6, 7, 8, 9, 10, 101, 102, 103, 104, 105, 106, 107, 108, 109]) {
      const p = makePlayer(id);
      p.m_idGuild = id < 100 ? ga : gb;
      harness.players.set(id, p);
    }
  }

  /** Run a full declare + accept, returning the war id. */
  function startWar(): number {
    assert.equal(service.declare_(ma, 'Beta'), true);
    assert.equal(service.accept(mb, ga), true);
    const g = guilds.get(ga)!;
    assert.notEqual(g.idWar, 0);
    return g.idWar;
  }

  function reset(): void {
    harness.sent.length = 0;
    harness.broadcasts.length = 0;
    harness.around.length = 0;
    notices.length = 0;
  }

  beforeEach(() => {
    harness = makeHarness();
    clock = 1_700_000_000_000;
    flag = true;
    notices = [];
    guilds = new GuildManager(undefined, () => clock);
    wars = new GuildWarManager(undefined, () => clock);
    service = new GuildWarService({
      playerManager: harness.playerManager as never,
      zoneManager: harness.zoneManager as never,
      guildManager: guilds,
      guildWarManager: wars,
      isWarEnabled: () => flag,
      sendDefinedText: (p: CPlayer, tid: number, args?: string) => {
        notices.push({ id: p.m_idPlayer, tid, args });
      },
      now: () => clock,
    });
    seedGuilds();
  });

  afterEach(() => { service.dispose(); });

  describe('declare -- the EVE_GUILDWAR gate (divergence 1)', () => {
    it('refuses with the flag off, even though C++ CoreServer would allow it', () => {
      // C++ gates the flag only world-side, so a war could be declared with it
      // off, lock both rosters, and never expire. See docs/c++-fidelity-audit.md.
      flag = false;
      assert.equal(service.declare_(ma, 'Beta'), false);
      assert.equal(harness.sent.length, 0);
      assert.equal(guilds.get(ga)!.idWar, 0);
    });

    it('allows it with the flag on', () => {
      assert.equal(service.declare_(ma, 'Beta'), true);
    });
  });

  describe('declare -- ported gates', () => {
    it('refuses a guildless caller', () => {
      const stranger = makePlayer(500);
      harness.players.set(500, stranger);
      assert.equal(service.declare_(stranger, 'Beta'), false);
      assert.equal(harness.sent.length, 0);
    });

    it('refuses a non-master member', () => {
      const member = harness.players.get(2)!;
      assert.equal(service.declare_(member, 'Beta'), false);
      assert.equal(harness.sent.length, 0);
    });

    it('refuses below own guild level 6', () => {
      guilds.get(ga)!.level = GUILD_WAR_MIN_LEVEL - 1;
      assert.equal(service.declare_(ma, 'Beta'), false);
    });

    it('refuses when the TARGET is below level 6', () => {
      guilds.get(gb)!.level = GUILD_WAR_MIN_LEVEL - 1;
      assert.equal(service.declare_(ma, 'Beta'), false);
    });

    it('refuses an unknown guild name', () => {
      assert.equal(service.declare_(ma, 'Nonexistent'), false);
    });

    it('refuses when the target master is OFFLINE', () => {
      harness.players.delete(100);
      assert.equal(service.declare_(ma, 'Beta'), false);
    });

    it('refuses a target roster below 10 -- but does NOT check its own size', () => {
      const b = guilds.get(gb)!;
      // splice, not `length =`: truncating and restoring `length` leaves holes
      // that every later roster walk trips over.
      const spare = b.members.splice(GUILD_WAR_MIN_TARGET_MEMBERS - 1);
      assert.equal(service.declare_(ma, 'Beta'), false);
      b.members.push(...spare);
      // Own roster small, target's full: allowed. Only the TARGET is gated
      // (DPCacheSrvr.cpp:2487 checks pAcpt->GetSize() only).
      guilds.get(ga)!.members.splice(1);
      assert.equal(service.declare_(ma, 'Beta'), true);
    });

    it('refuses declaring on itself', () => {
      assert.equal(service.declare_(ma, 'Alpha'), false);
    });

    it('refuses when already at war', () => {
      startWar();
      reset();
      assert.equal(service.declare_(ma, 'Beta'), false);
    });

    it('sends DECL_GUILD_WAR to the TARGET master only, carrying the DECLARER id', () => {
      service.declare_(ma, 'Beta');
      assert.equal(harness.sent.length, 1);
      assert.equal(harness.sent[0]!.id, 100, 'target master');
      const buf = harness.sent[0]!.buf;
      assert.equal(op(buf), PACKETTYPE.DECL_GUILD_WAR);
      assert.equal(buf.readUInt32LE(4), ga, 'the DECLARING guild id, not the target');
    });

    it('refuses a second declaration against the same target', () => {
      assert.equal(service.declare_(ma, 'Beta'), true);
      assert.equal(service.declare_(ma, 'Beta'), false);
    });
  });

  describe('accept -- proposal validation (divergence 2)', () => {
    it('refuses a forged accept naming a guild that never declared', () => {
      // C++ OnAcptWar takes idDecl off the wire unchecked -- the author's own
      // `// fixme - raiders` (DPCacheSrvr.cpp:2502).
      assert.equal(service.accept(mb, ga), false);
      assert.equal(guilds.get(gb)!.idWar, 0);
      assert.equal(harness.broadcasts.length, 0);
    });

    it('refuses when the accept names a DIFFERENT guild than the one that declared', () => {
      const c = guilds.create('Gamma', 200, [201, 202])!;
      c.level = GUILD_WAR_MIN_LEVEL;
      service.declare_(ma, 'Beta');
      reset();
      assert.equal(service.accept(mb, c.id), false);
    });

    it('accepts a real declaration and consumes the proposal', () => {
      service.declare_(ma, 'Beta');
      assert.equal(service.accept(mb, ga), true);
      // A replay must fail -- the proposal is spent.
      assert.equal(service.accept(mb, ga), false);
    });

    it('refuses with the flag off', () => {
      service.declare_(ma, 'Beta');
      flag = false;
      assert.equal(service.accept(mb, ga), false);
    });
  });

  describe('accept -- ported gates and effects', () => {
    beforeEach(() => { service.declare_(ma, 'Beta'); reset(); });

    it('refuses a non-master accepter', () => {
      assert.equal(service.accept(harness.players.get(101)!, ga), false);
    });

    it('refuses when the DECLARING master went offline', () => {
      harness.players.delete(1);
      assert.equal(service.accept(mb, ga), false);
    });

    it('links both guilds to the war with each other as the enemy', () => {
      service.accept(mb, ga);
      const a = guilds.get(ga)!;
      const b = guilds.get(gb)!;
      assert.notEqual(a.idWar, 0);
      assert.equal(a.idWar, b.idWar);
      assert.equal(a.idEnemyGuild, gb);
      assert.equal(b.idEnemyGuild, ga);
    });

    it('stamps m_idWar on every ONLINE member of both sides', () => {
      service.accept(mb, ga);
      const warId = guilds.get(ga)!.idWar;
      for (const id of [1, 2, 10, 100, 101, 109]) {
        assert.equal(harness.players.get(id)!.m_idWar, warId, `player ${id}`);
      }
    });

    it('freezes each side size from the roster at accept time', () => {
      service.accept(mb, ga);
      const war = wars.get(guilds.get(ga)!.idWar)!;
      assert.equal(war.decl.size, 10);
      assert.equal(war.acpt.size, 10);
      // Recruiting afterwards must not move it.
      guilds.addMember(ga, 11);
      assert.equal(war.decl.size, 10);
    });

    it('broadcasts ACPT_GUILD_WAR to the whole shard, not just the two rosters', () => {
      service.accept(mb, ga);
      const acpt = harness.broadcasts.filter((b) => op(b) === PACKETTYPE.ACPT_GUILD_WAR);
      assert.equal(acpt.length, 1);
      const buf = acpt[0]!;
      assert.equal(buf.readUInt32LE(8), ga, 'idDecl');
      assert.equal(buf.readUInt32LE(12), gb, 'idAcpt');
    });

    it('fans SET_WAR out to visibility range so peers re-render hostility', () => {
      service.accept(mb, ga);
      const setWar = harness.around.filter((b) => subtype(b) === SNAPSHOTTYPE.SET_WAR);
      assert.equal(setWar.length, 20, 'one per online member of both sides');
    });
  });

  describe('isAtWar interaction with GuildService guards', () => {
    it('a live war makes the guild read as at war; a truce clears both sides', () => {
      const warId = startWar();
      assert.ok(wars.get(warId));
      service.queryTruce(ma);
      assert.equal(service.acceptTruce(mb), true);
      assert.equal(guilds.get(ga)!.idWar, 0);
      assert.equal(guilds.get(gb)!.idWar, 0);
      assert.equal(guilds.get(ga)!.idEnemyGuild, 0);
    });
  });

  describe('surrender', () => {
    let warId: number;
    beforeEach(() => { warId = startWar(); reset(); });

    it('a MASTER surrender ends the war immediately, crediting the other side', () => {
      assert.equal(service.surrender(ma), true);
      assert.equal(wars.get(warId), undefined);
      const end = harness.broadcasts.filter((b) => op(b) === PACKETTYPE.WAR_END);
      assert.equal(end.length, 1);
      assert.equal(end[0]!.readUInt32LE(16), WR_ACPT_SR, 'declarer gave up -> accepter wins');
      assert.equal(guilds.get(gb)!.win, 1);
      assert.equal(guilds.get(ga)!.lose, 1);
    });

    it('the mirror -- the accepting master surrendering yields WR_DECL_SR', () => {
      service.surrender(mb);
      const end = harness.broadcasts.filter((b) => op(b) === PACKETTYPE.WAR_END)[0]!;
      assert.equal(end.readUInt32LE(16), WR_DECL_SR);
      assert.equal(guilds.get(ga)!.win, 1);
    });

    it('a single member surrender does NOT end the war', () => {
      assert.equal(service.surrender(harness.players.get(2)!), true);
      assert.ok(wars.get(warId), 'war still live');
      assert.equal(harness.broadcasts.filter((b) => op(b) === PACKETTYPE.WAR_END).length, 0);
    });

    it('needs STRICTLY MORE than 70% -- at size 10 that is 8, not 7', () => {
      // (7*100)/10 = 70, and C++ tests `> 70` (DPCacheSrvr.cpp:2312).
      for (const id of [2, 3, 4, 5, 6, 7, 8]) service.surrender(harness.players.get(id)!);
      assert.ok(wars.get(warId), '7 of 10 = exactly 70%, war continues');
      service.surrender(harness.players.get(9)!);
      assert.equal(wars.get(warId), undefined, '8 of 10 = 80%, war ends');
    });

    it('notifies BOTH rosters, not just the surrendering side', () => {
      service.surrender(harness.players.get(2)!);
      const notices = harness.sent.filter((s) => op(s.buf) === PACKETTYPE.SURRENDER);
      const ids = new Set(notices.map((n) => n.id));
      assert.ok(ids.has(1), 'own master told');
      assert.ok(ids.has(100), 'enemy master told');
      assert.equal(notices.length, 20);
    });

    it('clears the surrenderer own m_idWar even while the war continues', () => {
      const p = harness.players.get(2)!;
      service.surrender(p);
      assert.equal(p.m_idWar, 0, 'unconditional at DPCacheSrvr.cpp:2332');
      assert.equal(harness.players.get(3)!.m_idWar, warId, 'others unaffected');
    });

    it('bumps the MEMBER counter but leaves the guild-level one alone', () => {
      service.surrender(harness.players.get(2)!);
      assert.equal(guilds.getMember(ga, 2)!.surrender, 1);
      // m_nSurrender on CGuild has no writer anywhere in the C++ tree.
      assert.equal(guilds.get(ga)!.surrender, 0);
    });

    it('a player not in a war is refused', () => {
      const stranger = makePlayer(500);
      harness.players.set(500, stranger);
      assert.equal(service.surrender(stranger), false);
    });
  });

  describe('truce', () => {
    let warId: number;
    beforeEach(() => { warId = startWar(); reset(); });

    it('queryTruce forwards an EMPTY-bodied packet to the other master only', () => {
      assert.equal(service.queryTruce(ma), true);
      assert.equal(harness.sent.length, 1);
      assert.equal(harness.sent[0]!.id, 100);
      const buf = harness.sent[0]!.buf;
      assert.equal(op(buf), PACKETTYPE.QUERY_TRUCE);
      assert.equal(buf.length, 4, 'opcode only');
    });

    it('queryTruce is master-only', () => {
      assert.equal(service.queryTruce(harness.players.get(2)!), false);
      assert.equal(harness.sent.length, 0);
    });

    it('refuses an accept with no open request (divergence 2)', () => {
      // C++ OnAcptTruce calls Result with zero checks (DPCacheSrvr.cpp:2402).
      assert.equal(service.acceptTruce(mb), false);
      assert.ok(wars.get(warId));
    });

    it('refuses the ASKER accepting its own request', () => {
      service.queryTruce(ma);
      assert.equal(service.acceptTruce(ma), false);
      assert.ok(wars.get(warId));
    });

    it('refuses a non-master of the asked guild', () => {
      service.queryTruce(ma);
      assert.equal(service.acceptTruce(harness.players.get(101)!), false);
    });

    it('the asked master accepting ends the war and changes NEITHER record', () => {
      service.queryTruce(ma);
      reset();
      assert.equal(service.acceptTruce(mb), true);
      assert.equal(wars.get(warId), undefined);
      const end = harness.broadcasts.filter((b) => op(b) === PACKETTYPE.WAR_END)[0]!;
      assert.equal(end.readUInt32LE(16), WR_TRUCE);
      for (const id of [ga, gb]) {
        const g = guilds.get(id)!;
        assert.equal(g.win, 0);
        assert.equal(g.lose, 0);
        assert.equal(g.winPoint, 0);
      }
    });
  });

  describe('onWarDeath', () => {
    let warId: number;
    beforeEach(() => { warId = startWar(); reset(); });

    it('a MASTER death ends the war -- and the winner is the OTHER side', () => {
      // Result( ..., (int)bDecl ) -- a dead declaring master passes 1 = WR_ACPT_GN.
      service.onWarDeath(ma);
      assert.equal(wars.get(warId), undefined);
      const end = harness.broadcasts.filter((b) => op(b) === PACKETTYPE.WAR_END)[0]!;
      assert.equal(end.readUInt32LE(16), WR_ACPT_GN);
      assert.equal(guilds.get(gb)!.win, 1);
    });

    it('and the mirror', () => {
      service.onWarDeath(mb);
      const end = harness.broadcasts.filter((b) => op(b) === PACKETTYPE.WAR_END)[0]!;
      assert.equal(end.readUInt32LE(16), WR_DECL_GN);
      assert.equal(guilds.get(ga)!.win, 1);
    });

    it('a regular death bumps nDead and tells both rosters', () => {
      service.onWarDeath(harness.players.get(2)!);
      assert.ok(wars.get(warId));
      assert.equal(wars.get(warId)!.decl.dead, 1);
      const dead = harness.sent.filter((s) => op(s.buf) === PACKETTYPE.WAR_DEAD);
      assert.equal(dead.length, 20);
    });

    it('a death outside any war is ignored', () => {
      const stranger = makePlayer(500);
      harness.players.set(500, stranger);
      service.onWarDeath(stranger);
      assert.equal(harness.sent.length, 0);
    });
  });

  describe('tick', () => {
    let warId: number;
    beforeEach(() => { warId = startWar(); reset(); });

    it('does nothing with the flag off -- the C++ tick is behind EVE_GUILDWAR', () => {
      flag = false;
      clock += GUILD_WAR_DURATION_MS + 1000;
      service.tick(50);
      assert.ok(wars.get(warId), 'war never expires with the flag off');
    });

    it('accumulates absence only for a side whose master is OFFLINE', () => {
      harness.players.delete(1);
      service.tick(1000);
      const war = wars.get(warId)!;
      assert.equal(war.decl.absent, 1);
      assert.equal(war.acpt.absent, 0);
    });

    it('resolves an expired war by absence, more-absent losing', () => {
      harness.players.delete(1);
      for (let i = 0; i < 5; i++) service.tick(1000);
      clock += GUILD_WAR_DURATION_MS + 1000;
      service.tick(50);
      assert.equal(wars.get(warId), undefined);
      const end = harness.broadcasts.filter((b) => op(b) === PACKETTYPE.WAR_END)[0]!;
      // decl master was away -> accepter wins by absence.
      assert.equal(end.readUInt32LE(16), 5 /* WR_ACPT_AB */);
    });

    it('an expired war with nothing to separate the sides is a DRAW that scores nothing', () => {
      clock += GUILD_WAR_DURATION_MS + 1000;
      service.tick(50);
      const end = harness.broadcasts.filter((b) => op(b) === PACKETTYPE.WAR_END)[0]!;
      assert.equal(end.readUInt32LE(16), WR_DRAW);
      assert.equal(guilds.get(ga)!.win, 0);
      assert.equal(guilds.get(gb)!.win, 0);
    });

    it('resolves each war exactly once even if ticked again', () => {
      clock += GUILD_WAR_DURATION_MS + 1000;
      service.tick(50);
      service.tick(50);
      assert.equal(harness.broadcasts.filter((b) => op(b) === PACKETTYPE.WAR_END).length, 1);
    });

    it('clears m_idWar on every online member when a war resolves', () => {
      clock += GUILD_WAR_DURATION_MS + 1000;
      service.tick(50);
      for (const id of [1, 2, 100, 101]) {
        assert.equal(harness.players.get(id)!.m_idWar, 0, `player ${id}`);
      }
    });
  });

  describe('isWarTarget', () => {
    beforeEach(() => { startWar(); });

    it('is true across the two warring guilds', () => {
      assert.equal(service.isWarTarget(ma, mb), true);
    });

    it('is FALSE inside one guild -- the different-guild test blocks friendly fire', () => {
      assert.equal(service.isWarTarget(ma, harness.players.get(2)!), false);
    });

    it('is false for a surrendered member whose m_idWar was cleared', () => {
      const p = harness.players.get(2)!;
      service.surrender(p);
      assert.equal(service.isWarTarget(p, mb), false);
    });

    it('is false with the flag off even mid-war', () => {
      flag = false;
      assert.equal(service.isWarTarget(ma, mb), false);
    });

    it('is false for two guildless players', () => {
      const x = makePlayer(600); const y = makePlayer(601);
      assert.equal(service.isWarTarget(x, y), false);
    });
  });

  describe('isInWar -- PK suppression + duel refusal', () => {
    it('is true for a warring member and false for a bystander', () => {
      startWar();
      assert.equal(service.isInWar(ma), true);
      assert.equal(service.isInWar(harness.players.get(2)!), true);
      const stranger = makePlayer(600);
      assert.equal(service.isInWar(stranger), false);
    });

    it('is false with the flag off -- both C++ call sites check it first', () => {
      startWar();
      flag = false;
      assert.equal(service.isInWar(ma), false);
    });

    it('goes false for a member who surrendered, and for everyone once the war ends', () => {
      startWar();
      const quitter = harness.players.get(2)!;
      service.surrender(quitter);
      assert.equal(service.isInWar(quitter), false);
      assert.equal(service.isInWar(ma), true, 'the rest are still in it');
      service.surrender(ma);  // master -> war over
      assert.equal(service.isInWar(harness.players.get(3)!), false);
    });
  });

  describe('onJoin', () => {
    it('sends the full war record to a relogging member', () => {
      startWar();
      reset();
      ma.m_idWar = 0;
      service.onJoin(ma);
      assert.equal(ma.m_idWar, guilds.get(ga)!.idWar);
      const war = harness.sent.filter((s) => subtype(s.buf) === SNAPSHOTTYPE.WAR);
      assert.equal(war.length, 1);
    });

    it('sends nothing for a guilded player not at war', () => {
      service.onJoin(ma);
      assert.equal(harness.sent.length, 0);
      assert.equal(ma.m_idWar, 0);
    });

    it('sends nothing for a guildless player', () => {
      const stranger = makePlayer(500);
      service.onJoin(stranger);
      assert.equal(harness.sent.length, 0);
    });
  });

  describe('relinkAfterHydrate', () => {
    it('re-derives both guilds idWar/idEnemyGuild from the war rows', () => {
      const warId = wars.addWar(ga, 10, gb, 10);
      service.relinkAfterHydrate();
      assert.equal(guilds.get(ga)!.idWar, warId);
      assert.equal(guilds.get(ga)!.idEnemyGuild, gb);
      assert.equal(guilds.get(gb)!.idEnemyGuild, ga);
    });

    it('drops a war whose guild no longer exists', () => {
      const warId = wars.addWar(ga, 10, 9999, 10);
      service.relinkAfterHydrate();
      assert.equal(wars.get(warId), undefined);
    });
  });

  describe('stale war id self-heal', () => {
    it('a guild pointing at a vanished war reads as at peace, and is repaired', () => {
      const warId = startWar();
      // Simulate the war record disappearing without the cleanup (crash between
      // the two writes). C++ never needs this because CoreServer holds both maps.
      wars.removeWar(warId);
      assert.equal(guilds.get(ga)!.idWar, warId, 'stale id still set');
      assert.equal(service.queryTruce(ma), false);
      assert.equal(guilds.get(ga)!.idWar, 0, 'healed on read');
    });
  });

  /**
   * Refusal notices. War has NINE declare gates; without a distinct text per
   * gate a failed declaration is indistinguishable from a bug, which is exactly
   * the report ("the declare button does nothing") this is meant to prevent.
   */
  describe('refusal notices', () => {
    function soleTid(): number {
      assert.equal(notices.length, 1, 'exactly one notice');
      return notices[0]!.tid;
    }

    it('names each of the nine declare gates distinctly', () => {
      // Guildless caller.
      const stranger = makePlayer(700);
      harness.players.set(700, stranger);
      reset(); service.declare_(stranger, 'Beta');
      assert.equal(soleTid(), TID_GAME_COMNOHAVECOM);

      // Not the master.
      reset(); service.declare_(harness.players.get(2)!, 'Beta');
      assert.equal(soleTid(), TID_GAME_COMDELNOTKINGPIN);

      // Own guild below level 6.
      guilds.get(ga)!.level = GUILD_WAR_MIN_LEVEL - 1;
      reset(); service.declare_(ma, 'Beta');
      assert.equal(soleTid(), TID_GAME_GUILDWARREQLV6);
      guilds.get(ga)!.level = GUILD_WAR_MIN_LEVEL;

      // No such guild.
      reset(); service.declare_(ma, 'Nonexistent');
      assert.equal(soleTid(), TID_GAME_GUILDWARNOTHINGGUILD);

      // Target below level 6 -- note the misspelled OHTER constant.
      guilds.get(gb)!.level = GUILD_WAR_MIN_LEVEL - 1;
      reset(); service.declare_(ma, 'Beta');
      assert.equal(soleTid(), TID_GAME_GUILDWAROHTERLV6);
      guilds.get(gb)!.level = GUILD_WAR_MIN_LEVEL;

      // Target master offline.
      harness.players.delete(100);
      reset(); service.declare_(ma, 'Beta');
      assert.equal(soleTid(), TID_GAME_GUILDWARMASTEROFF);
      harness.players.set(100, mb);

      // Target roster below 10. Save the removed entries -- truncating an array
      // discards them, and restoring only `length` would leave holes that break
      // every later roster walk.
      const bMembers = guilds.get(gb)!.members;
      const removed = bMembers.splice(GUILD_WAR_MIN_TARGET_MEMBERS - 1);
      reset(); service.declare_(ma, 'Beta');
      assert.equal(soleTid(), TID_GAME_GUILDWARMEMBER10);
      bMembers.push(...removed);

      // Already at war -- both the own-guild and other-guild variants.
      startWar();
      reset(); service.declare_(ma, 'Beta');
      assert.equal(soleTid(), TID_GAME_GUILDWARSTILLNOWAR);
    });

    it('a forged accept says NOREQUEST rather than nothing', () => {
      reset();
      assert.equal(service.accept(mb, ga), false);
      assert.equal(soleTid(), TID_GAME_GUILDWARNOREQUEST);
    });

    it('an accept naming a guild that does not exist says NOFINDGUILD', () => {
      service.declare_(ma, 'Beta');
      reset();
      assert.equal(service.accept(mb, 9999), false);
      assert.equal(soleTid(), TID_GAME_GUILDWARNOFINDGUILD);
    });

    it('surrender with no war says NOETC', () => {
      reset();
      assert.equal(service.surrender(ma), false);
      assert.equal(soleTid(), TID_GAME_GUILDWARNOETC);
    });

    it('a non-master asking for a truce says NOTKINGPIN', () => {
      startWar();
      reset();
      assert.equal(service.queryTruce(harness.players.get(2)!), false);
      assert.equal(soleTid(), TID_GAME_COMDELNOTKINGPIN);
    });

    it('the asker accepting its own truce is refused as not-the-master', () => {
      startWar();
      service.queryTruce(ma);
      reset();
      assert.equal(service.acceptTruce(ma), false);
      assert.equal(soleTid(), TID_GAME_GUILDWARNOREQUEST, 'no request aimed at them');
    });

    it('a successful declare + accept sends NO notice', () => {
      reset();
      assert.equal(service.declare_(ma, 'Beta'), true);
      assert.equal(service.accept(mb, ga), true);
      assert.equal(notices.length, 0);
    });

    it('with the flag off declare is silent -- the client should not offer the button', () => {
      flag = false;
      reset();
      assert.equal(service.declare_(ma, 'Beta'), false);
      assert.equal(notices.length, 0, 'no C++ text covers "wrong server type" here');
    });
  });
});

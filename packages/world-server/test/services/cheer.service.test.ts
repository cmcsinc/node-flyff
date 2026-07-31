/**
 * CheerService tests -- `PACKETTYPE_CHEERING` (0xffffff7c).
 *
 * Covers the `DPSrvr::OnCheering` (DPSrvr.cpp:7068) gate order and the two
 * non-interchangeable `SetCheerParam` branches (full stock = fresh 60 min timer,
 * partial stock = preserve remaining), plus the gendered motion/text split and
 * `CheckTickCheer` regen (`Mover.cpp:9069`).
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  CPlayer, MAX_CHEERPOINT, TICK_CHEERPOINT_MS,
  MTI_CHEERSAME, MTI_CHEEROTHER, XI_CHEERSENDEFFECT, XI_CHEERRECEIVEEFFECT,
  TID_CHEER_MESSAGE3, TID_CHEER_MESSAGE4, TID_CHEER_NO1, TID_CHEER_NO2,
} from '@flyff/entities';
import { PACKETTYPE, SNAPSHOTTYPE } from '@flyff/core/constants/opcodes';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { SNAPSHOTTYPE_DEFINEDTEXT, SNAPSHOTTYPE_MOTION } from '@flyff/world-core';
import { CheerService, getDegree } from '../../src/services/cheer.service';

const NOW = 1_000_000;

function makePlayer(charId: number, sex = 0, pos = { x: 0, y: 0, z: 0 }): CPlayer {
  const p = Object.create(CPlayer.prototype) as CPlayer;
  p.m_idPlayer = charId;
  p.m_szName = `P${charId}`;
  p.m_nSex = sex;
  p.m_nZoneId = 1;
  p.m_vPos = pos;
  p.m_fAngle = 0;
  p.m_nCheerPoint = MAX_CHEERPOINT;
  p.m_dwTickCheer = NOW + TICK_CHEERPOINT_MS;
  return p;
}

interface Frame { readonly to: number; readonly buf: Buffer }

function makeDeps(players: readonly CPlayer[]) {
  const sent: Frame[] = [];
  const broadcasts: Frame[] = [];
  const playerManager = {
    get: (id: number) => players.find((p) => p.m_idPlayer === id),
    sendTo: (p: CPlayer, buf: Buffer) => { sent.push({ to: p.m_idPlayer, buf }); },
  } as unknown as ConstructorParameters<typeof CheerService>[0]['playerManager'];
  const zoneManager = {
    broadcastAround: (_pos: unknown, _z: number, _r: number, buf: Buffer) => {
      broadcasts.push({ to: -1, buf }); return 1;
    },
  } as unknown as ConstructorParameters<typeof CheerService>[0]['zoneManager'];
  return { deps: { playerManager, zoneManager }, sent, broadcasts };
}

/** Strip the SNAPSHOT preamble; return objid + subtype + a reader on the body. */
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
const find = (fs: readonly Frame[], subtype: number): Frame | undefined =>
  fs.find((f) => open(f.buf).subtype === subtype);

describe('CheerService', () => {
  it('refuses self-cheer before any other check', () => {
    const me = makePlayer(1);
    const { deps, sent } = makeDeps([me]);
    const out = new CheerService(deps).cheer(me, 1, NOW);
    assert.deepEqual(out, { ok: false, reason: 'self' });
    assert.equal(sent.length, 0);
    assert.equal(me.m_nCheerPoint, MAX_CHEERPOINT);   // no point spent
  });

  it('sends TID_CHEER_NO2 when the target is not a live player', () => {
    const me = makePlayer(1);
    const { deps, sent } = makeDeps([me]);
    const out = new CheerService(deps).cheer(me, 999, NOW);
    assert.deepEqual(out, { ok: false, reason: 'not-player' });

    const { subtype, r } = open(sent[0]!.buf);
    assert.equal(subtype, SNAPSHOTTYPE_DEFINEDTEXT);
    assert.equal(r.readDword(), TID_CHEER_NO2);
    assert.equal(r.readString(), '');
    assert.equal(me.m_nCheerPoint, MAX_CHEERPOINT);
  });

  it('sends TID_CHEER_NO1 with whole minutes left when out of points', () => {
    const me = makePlayer(1);
    const target = makePlayer(2);
    me.m_nCheerPoint = 0;
    me.m_dwTickCheer = NOW + 150_000;               // 2.5 min -> floor 2
    const { deps, sent } = makeDeps([me, target]);

    const out = new CheerService(deps).cheer(me, 2, NOW);
    assert.deepEqual(out, { ok: false, reason: 'no-points' });
    const { r } = open(sent[0]!.buf);
    assert.equal(r.readDword(), TID_CHEER_NO1);
    assert.equal(r.readString(), '2');
  });

  it('spending from a FULL stock starts a fresh 60-minute timer', () => {
    const me = makePlayer(1);
    const target = makePlayer(2);
    const { deps, sent } = makeDeps([me, target]);

    const out = new CheerService(deps).cheer(me, 2, NOW);
    assert.deepEqual(out, { ok: true, pointsLeft: MAX_CHEERPOINT - 1 });
    assert.equal(me.m_dwTickCheer, NOW + TICK_CHEERPOINT_MS);

    const frame = find(sent, SNAPSHOTTYPE.SETCHEERPARAM);
    const { objid, r } = open(frame!.buf);
    assert.equal(objid, 1);                          // self-only
    assert.equal(r.readDword(), MAX_CHEERPOINT - 1); // nCheerPoint
    assert.equal(r.readDword(), TICK_CHEERPOINT_MS); // dwRest
    assert.equal(r.readDword(), 0);                  // bAdd FALSE on spend
  });

  it('spending from a PARTIAL stock preserves the remaining time', () => {
    const me = makePlayer(1);
    const target = makePlayer(2);
    me.m_nCheerPoint = 2;                            // below MAX
    me.m_dwTickCheer = NOW + 90_000;                 // 90 s already elapsed toward next
    const { deps, sent } = makeDeps([me, target]);

    new CheerService(deps).cheer(me, 2, NOW);
    assert.equal(me.m_nCheerPoint, 1);
    assert.equal(me.m_dwTickCheer, NOW + 90_000);    // NOT reset to a fresh hour

    const { r } = open(find(sent, SNAPSHOTTYPE.SETCHEERPARAM)!.buf);
    r.readDword();
    assert.equal(r.readDword(), 90_000);
  });

  it('same-sex cheer uses MESSAGE3 + MTI_CHEERSAME', () => {
    const me = makePlayer(1, 0);
    const target = makePlayer(2, 0);
    const { deps, sent, broadcasts } = makeDeps([me, target]);

    new CheerService(deps).cheer(me, 2, NOW);

    const toTarget = sent.find((f) => f.to === 2)!;
    const { objid, r } = open(toTarget.buf);
    assert.equal(objid, 2);
    assert.equal(r.readDword(), TID_CHEER_MESSAGE3);
    assert.equal(r.readString(), 'P1');              // cheerer's name

    const motion = find(broadcasts, SNAPSHOTTYPE_MOTION)!;
    assert.equal(open(motion.buf).r.readDword(), MTI_CHEERSAME);
  });

  it('opposite-sex cheer uses MESSAGE4 + MTI_CHEEROTHER', () => {
    const me = makePlayer(1, 0);
    const target = makePlayer(2, 1);
    const { deps, sent, broadcasts } = makeDeps([me, target]);

    new CheerService(deps).cheer(me, 2, NOW);
    const { r } = open(sent.find((f) => f.to === 2)!.buf);
    assert.equal(r.readDword(), TID_CHEER_MESSAGE4);
    assert.equal(open(find(broadcasts, SNAPSHOTTYPE_MOTION)!.buf).r.readDword(), MTI_CHEEROTHER);
  });

  it('broadcasts both SFX effects and turns the cheerer toward the target', () => {
    const me = makePlayer(1, 0, { x: 0, y: 0, z: 0 });
    const target = makePlayer(2, 0, { x: 10, y: 0, z: 0 });   // due +X
    const { deps, broadcasts } = makeDeps([me, target]);

    new CheerService(deps).cheer(me, 2, NOW);

    // +X from the (0,0,-1) reference is 90 degrees.
    assert.equal(Math.round(me.m_fAngle), 90);

    const sfx = broadcasts.filter((f) => open(f.buf).subtype === SNAPSHOTTYPE.CREATESFXOBJ);
    assert.equal(sfx.length, 2);
    assert.equal(open(sfx[0]!.buf).objid, 1);
    assert.equal(open(sfx[0]!.buf).r.readDword(), XI_CHEERSENDEFFECT);
    assert.equal(open(sfx[1]!.buf).objid, 2);
    assert.equal(open(sfx[1]!.buf).r.readDword(), XI_CHEERRECEIVEEFFECT);

    // Motion + 2 SFX, nothing else on the wire for this path.
    assert.deepEqual(subtypes(broadcasts).sort((a, b) => a - b),
      [SNAPSHOTTYPE.CREATESFXOBJ, SNAPSHOTTYPE.CREATESFXOBJ, SNAPSHOTTYPE_MOTION]
        .sort((a, b) => a - b));
  });

  describe('tick (CheckTickCheer)', () => {
    it('grants a point once the timer elapses, with bAdd TRUE', () => {
      const me = makePlayer(1);
      me.m_nCheerPoint = 1;
      me.m_dwTickCheer = NOW - 1;                   // already due
      const { deps, sent } = makeDeps([me]);

      new CheerService(deps).tick(me, NOW);
      assert.equal(me.m_nCheerPoint, 2);
      assert.equal(me.m_dwTickCheer, NOW + TICK_CHEERPOINT_MS);

      const { r } = open(sent[0]!.buf);
      assert.equal(r.readDword(), 2);
      assert.equal(r.readDword(), TICK_CHEERPOINT_MS);
      assert.equal(r.readDword(), 1);               // bAdd TRUE on regen
    });

    it('is a no-op at MAX_CHEERPOINT or before the timer', () => {      const full = makePlayer(1);
      full.m_dwTickCheer = NOW - 1;
      const waiting = makePlayer(2);
      waiting.m_nCheerPoint = 0;
      waiting.m_dwTickCheer = NOW + 5_000;
      const { deps, sent } = makeDeps([full, waiting]);
      const svc = new CheerService(deps);

      svc.tick(full, NOW);
      svc.tick(waiting, NOW);
      assert.equal(full.m_nCheerPoint, MAX_CHEERPOINT);
      assert.equal(waiting.m_nCheerPoint, 0);
      assert.equal(sent.length, 0);
    });

    it('seeds an unseeded player (m_dwTickCheer 0) without granting a point', () => {
      const fresh = makePlayer(1);
      fresh.m_nCheerPoint = 0;
      fresh.m_dwTickCheer = 0;                      // never seeded
      const { deps, sent } = makeDeps([fresh]);

      new CheerService(deps).tick(fresh, NOW);
      assert.equal(fresh.m_nCheerPoint, 0);         // NOT a free point
      assert.equal(fresh.m_dwTickCheer, NOW + TICK_CHEERPOINT_MS);
      assert.equal(sent.length, 1);                 // SETCHEERPARAM with bAdd FALSE
      const { r } = open(sent[0]!.buf);
      assert.equal(r.readDword(), 0);
      r.readDword();
      assert.equal(r.readDword(), 0);
    });
  });

  describe('getDegree', () => {
    it('matches the C++ acos/360-x branch on the cardinals', () => {
      const o = { x: 0, y: 0, z: 0 };
      assert.equal(Math.round(getDegree({ x: 0, y: 0, z: -10 }, o)), 0);    // -Z reference
      assert.equal(Math.round(getDegree({ x: 10, y: 0, z: 0 }, o)), 90);
      assert.equal(Math.round(getDegree({ x: 0, y: 0, z: 10 }, o)), 180);
      assert.equal(Math.round(getDegree({ x: -10, y: 0, z: 0 }, o)), 270);  // x<0 -> 360-90
    });

    it('ignores the Y axis and handles the degenerate same-spot case', () => {
      const o = { x: 0, y: 0, z: 0 };
      assert.equal(Math.round(getDegree({ x: 10, y: 500, z: 0 }, o)), 90);
      assert.equal(getDegree(o, o), 0);
    });
  });
});

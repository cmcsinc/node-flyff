/**
 * BuffSystem -- per-second expiry sweep: expired buffs are removed from
 * BuffManager, REMOVESKILLINFULENCE broadcast, and vitals clamped.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CPlayer, DST } from '@flyff/entities';
import type { CharacterRow } from '@flyff/database';
import { BuffSystem } from '../../src/systems/buff.system';

function makeRow(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 42, account_id: 7, name: 'TestHero', slot: 0, class: 1, gender: 0,
    hair_style: 2, hair_color: 0, face_style: 3, skin_color: 1,
    level: 15, exp: 0n, hp: 100, mp: 50, max_hp: 100, max_mp: 50,
    strength: 15, stamina: 15, dexterity: 15, intelligence: 15,
    x: 0, y: 0, z: 0, world_id: 'MADRIGAL', zone_id: 1,
    created_at: new Date(), updated_at: new Date(), ...over,
  };
}

function makeSocket() {
  const written: Buffer[] = [];
  return { write: (b: Buffer) => { written.push(b); return true; }, _written: written };
}

interface Captured { objid: number; type: number; skillId: number; }

function makeDeps(player: CPlayer) {
  const sent: Buffer[] = [];
  const broadcasts: Captured[] = [];
  /** Raw vicinity frames -- needed to discriminate snapshot types by the type word. */
  const rawBroadcasts: Buffer[] = [];
  return {
    sent, broadcasts, rawBroadcasts,
    playerManager: {
      all: () => [player],
      sendTo: (_p: unknown, b: Buffer) => { sent.push(b); },
      get: (id: number) => (id === player.m_idPlayer ? player : undefined),
    },
    zoneManager: {
      broadcastAround: (_pos: unknown, _zid: number, _r: number, pkt: Buffer) => {
        broadcasts.push({ objid: 0, type: 0, skillId: 0 });
        rawBroadcasts.push(pkt);
        return 1;
      },
    },
  };
}

describe('BuffSystem.tick (expiry)', () => {
  it('expires buffs past their deadline, broadcasts removal, reverses effects', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    const deps = makeDeps(p);
    const sys = new BuffSystem(deps as never);

    // +20 STR buff, 10s duration, applied at t=0 (expires at 10_000).
    p.m_buffs.addSkillBuff(150, 1, 10_000, [{ dst: DST.STR, adj: 20 }], 0);
    assert.equal(p.m_params.get(DST.STR, 0), 20);

    sys.tick(11_000);

    assert.equal(p.m_buffs.has(150), false, 'buff expired + removed');
    assert.equal(p.m_params.get(DST.STR, 0), 0, 'STR effect reversed');
    // 1 REMOVESKILLINFULENCE + 1 RESETDESTPARAM (one-effect buff).
    assert.equal(deps.broadcasts.length, 2, 'removal + DST reverse broadcast');
  });

  it('clamps HP when a +HP_MAX buff expires and current HP exceeds the new cap', () => {
    const p = CPlayer.fromRow(makeRow({ hp: 200, max_hp: 200 }), makeSocket());
    const deps = makeDeps(p);
    const sys = new BuffSystem(deps as never);

    // +100 HP_MAX buff pushes the cap to 300; HP already 200 (under cap, fine).
    p.m_buffs.addSkillBuff(151, 1, 5_000, [{ dst: DST.HP_MAX, adj: 100 }], 0);
    const buffedMax = p.getMaxHp();
    assert.ok(buffedMax > 200, 'HP_MAX raised by the buff');

    // Manually raise HP above the post-expiry cap, then expire the buff.
    p.m_nHp = buffedMax;
    sys.tick(6_000);

    assert.equal(p.m_buffs.has(151), false);
    assert.ok(p.m_nHp <= p.getMaxHp(), 'HP clamped to the new (lower) cap');
    // The clamp SETPOINTPARAM is a vicinity broadcast, not a self-only send:
    // C++ `CUserMng::AddSetPointParam` (`WORLDSERVER/User.cpp:4658`) is
    // FOR_VISIBILITYRANGE, so peers watching this player see the bar drop too.
    const SETPOINTPARAM = 0x001e;
    const clamps = deps.rawBroadcasts.filter((b: Buffer) => b.readUInt16LE(14) === SETPOINTPARAM);
    assert.ok(clamps.length >= 1, 'HP clamp broadcast to the vicinity');
  });

  it('skips dead players', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    p.m_bDead = true;
    const deps = makeDeps(p);
    const sys = new BuffSystem(deps as never);

    p.m_buffs.addSkillBuff(150, 1, 1_000, [{ dst: DST.STR, adj: 20 }], 0);
    sys.tick(5_000);
    // Buff NOT expired by the system (dead skip) -- stays in the container.
    assert.equal(p.m_buffs.has(150), true);
    assert.equal(deps.broadcasts.length, 0);
  });

  it('start/stop is idempotent', () => {
    const p = CPlayer.fromRow(makeRow(), makeSocket());
    const sys = new BuffSystem(makeDeps(p) as never);
    sys.start(); sys.start();
    sys.stop(); sys.stop();
    assert.ok(true, 'no throw on double start/stop');
  });
});

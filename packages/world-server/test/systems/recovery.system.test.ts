/**
 * RecoverySystem unit tests. Drives the public `tick(now)` directly (no timers)
 * so the 3 s cadence + 10 s combat gate are asserted deterministically.
 */
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { CharacterRow } from '@flyff/database';
import { CPlayer } from '../../src/entities/player.js';
import { RecoverySystem } from '../../src/systems/recovery.system.js';
import { DST_HP, DST_MP, DST_FP } from '../../src/net/snapshot/pointParam.serializer.js';
import type { PlayerManager } from '../../src/managers/player.manager.js';

function makeRow(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 1, account_id: 1, name: 'P', slot: 0, class: 0, gender: 0,
    hair_style: 0, hair_color: 0, face_style: 0, skin_color: 0,
    level: 1, exp: 0n, hp: 100, mp: 40, max_hp: 200, max_mp: 100,
    strength: 15, stamina: 15, dexterity: 15, intelligence: 15,
    x: 0, y: 0, z: 0, world_id: 'flaris', zone_id: 1,
    created_at: new Date(), updated_at: new Date(),
    ...over,
  };
}

interface Sent { param: number; value: number }

/** Minimal PlayerManager stub: serves one player + records sendTo calls. */
function fakeManager(player: CPlayer): { mgr: PlayerManager; sent: Sent[] } {
  const sent: Sent[] = [];
  const mgr = {
    all: () => [player],
    sendTo: (_p: CPlayer, buf: Buffer) => {
      // SETPOINTPARAM layout (after the SNAPSHOT framing DWORDs): objid:DWORD,
      // word(0x001e), param:DWORD, value:DWORD. Parse the last two DWORDs.
      const param = buf.readUInt32LE(buf.length - 8);
      const value = buf.readUInt32LE(buf.length - 4);
      sent.push({ param, value });
    },
  } as unknown as PlayerManager;
  return { mgr, sent };
}

describe('RecoverySystem', () => {
  it('regenerates HP/MP/FP on the first tick (m_tmNextRecovery starts at 0)', () => {
    const player = CPlayer.fromRow(makeRow({ hp: 100, mp: 40 }), { write: () => true });
    const before = { hp: player.m_nHp, mp: player.m_nMp, fp: player.m_nFp };
    const { mgr, sent } = fakeManager(player);
    const sys = new RecoverySystem({ playerManager: mgr });

    sys.tick(1000);

    assert.ok(player.m_nHp > before.hp, 'HP increased');
    assert.ok(player.m_nMp > before.mp, 'MP increased');
    assert.ok(player.m_nFp > before.fp, 'FP increased');
    assert.ok(player.m_nMaxFp > 0, 'max FP derived from formula');
    // One SETPOINTPARAM per changed vital.
    const params = sent.map((s) => s.param).sort();
    assert.deepEqual(params, [DST_FP, DST_HP, DST_MP].sort());
  });

  it('clamps HP/MP/FP at their max (no overheal)', () => {
    // Max HP/MP are formula-derived (ignores the DB max_hp/max_mp cache).
    // Start vitals above their ceiling and confirm one tick clamps them down.
    const player = CPlayer.fromRow(makeRow({ hp: 9999, mp: 9999 }), { write: () => true });
    player.m_nFp = 9999;
    const { mgr } = fakeManager(player);
    const sys = new RecoverySystem({ playerManager: mgr });

    sys.tick(1000);

    assert.equal(player.m_nHp, player.m_nMaxHp);
    assert.equal(player.m_nMp, player.m_nMaxMp);
    assert.equal(player.m_nFp, player.m_nMaxFp);
    assert.ok(player.m_nMaxHp > 100, 'max HP is the formula value, not the stale DB cache');
  });

  it('does not regenerate within the 10 s combat gate after damage', () => {
    const player = CPlayer.fromRow(makeRow({ hp: 100, mp: 40 }), { write: () => true });
    const { mgr, sent } = fakeManager(player);
    const sys = new RecoverySystem({ playerManager: mgr });

    player.m_tmLastDamage = 5_000; // damaged 5 s ago -> within 10 s gate
    sys.tick(10_000);

    assert.equal(sent.length, 0, 'no regen while in combat');
    // Combat branch pushes the next-recovery timer forward so regen waits a
    // fresh 3 s after combat clears instead of firing instantly.
    assert.equal(player.m_tmNextRecovery, 10_000 + 3_000);
  });

  it('regenerates once combat has cleared (>= 10 s since last damage)', () => {
    const player = CPlayer.fromRow(makeRow({ hp: 100, mp: 40 }), { write: () => true });
    const { mgr, sent } = fakeManager(player);
    const sys = new RecoverySystem({ playerManager: mgr });

    player.m_tmLastDamage = 100; // damaged 19.9 s ago -> outside the 10 s gate
    sys.tick(20_000);

    assert.ok(sent.length > 0, 'regen fired after combat cleared');
  });

  it('fires at most once per 3 s stand cadence', () => {
    const player = CPlayer.fromRow(makeRow({ hp: 100, mp: 40 }), { write: () => true });
    const { mgr, sent } = fakeManager(player);
    const sys = new RecoverySystem({ playerManager: mgr });

    sys.tick(1_000);  // first fire (m_tmNextRecovery was 0); next armed at 4_000
    const afterFirst = player.m_nHp;
    sent.length = 0;
    sys.tick(2_000);  // only 1 s later -> still within the 3 s window
    assert.equal(sent.length, 0, 'no second fire inside the 3 s window');
    assert.equal(player.m_nHp, afterFirst);

    sys.tick(4_000);  // 3 s after the first fire -> fires again
    assert.ok(sent.length > 0, 'second fire after the 3 s window elapsed');
  });

  it('skips dead players', () => {
    const player = CPlayer.fromRow(makeRow({ hp: 0 }), { write: () => true });
    player.m_bDead = true;
    const { mgr, sent } = fakeManager(player);
    const sys = new RecoverySystem({ playerManager: mgr });

    sys.tick(1_000);

    assert.equal(sent.length, 0);
    assert.equal(player.m_nHp, 0);
  });
});

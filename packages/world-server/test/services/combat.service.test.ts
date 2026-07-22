/**
 * CombatService integration test -- proves the wiring: a swing broadcasts
 * DAMAGE, a lethal blow broadcasts MOVERDEATH + grants exp (WAL-journaled) +
 * removes the mover. Uses a deterministic `Rng` (always-hit, fixed damage) and
 * in-memory mock managers.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CombatService } from '../../src/services/combat.service.js';
import type { Rng } from '../../src/combat/formulas.js';
import { CPlayer } from '../../src/entities/player.js';
import type { CharacterRow } from '@flyff/database';
import { CMover } from '../../src/entities/mover.js';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import { MODE } from '../../src/constants/mode.js';

function makeRow(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 1, account_id: 1, name: 'Tester', slot: 0, class: 0, gender: 0,
    hair_style: 0, hair_color: 0, face_style: 0, skin_color: 0,
    level: 1, exp: 0n, hp: 200, mp: 100, max_hp: 200, max_mp: 100,
    strength: 15, stamina: 15, dexterity: 15, intelligence: 15,
    x: 0, y: 0, z: 0, world_id: 'flaris', zone_id: 1,
    created_at: new Date(), updated_at: new Date(),
    ...over,
  };
}

/** Deterministic rng: always hit, never crit, never block, fixed damage roll. */
const fixedRng: Rng = {
  int: (() => { const seq = [0, 99, 50]; let i = 0; return () => seq[i++ % seq.length]; })(),
  range: () => 16,
};

/** Read the snapshot subtype (WORD) from an UNFRAMED serializer payload. */
function snapshotSubtype(payload: Buffer): number {
  // [SNAPSHOT:4][NULL_ID:4][count:2][objid:4][subtype:2] -> subtype at offset 14.
  return payload.readUInt16LE(14);
}

/** Read the victim objid (DWORD) from an UNFRAMED snapshot payload. */
function snapshotVictim(payload: Buffer): number {
  // objid at offset 10 (after [SNAPSHOT:4][NULL_ID:4][count:2]).
  return payload.readUInt32LE(10);
}

describe('CombatService.resolveAttack', () => {
  it('broadcasts DAMAGE per swing; lethal blow -> MOVERDEATH + exp + WAL + remove', () => {
    const writes: Buffer[] = [];
    const socket = { write: (b: Buffer) => { writes.push(b); return true; } };
    const player = CPlayer.fromRow(makeRow(), socket);
    player.m_nZoneId = 1;
    player.m_vPos = { x: 0, y: 0, z: 0 };

    const mover = CMover.spawn(
      0x40000000,
      { modelIndex: 20, name: 'Aibatt', level: 1, hp: 30, atkMin: 16, atkMax: 16, armor: 3, hr: 40, er: 3, expValue: 2 },
      { x: 0, y: 0, z: 0 },
      1,
    );
    const spawns = new Map([[mover.m_idMover, mover]]);
    let killCalled = false;
    const spawnManager = {
      get: (id: number) => spawns.get(id),
      kill: () => { killCalled = true; },
    };

    const broadcasts: Buffer[] = [];
    const sends: Buffer[] = [];
    const zoneManager = {
      broadcastAround: (_p: unknown, _z: number, _r: number, buf: Buffer) => { broadcasts.push(buf); return 1; },
    };
    const playerManager = { sendTo: (_p: unknown, buf: Buffer) => { sends.push(buf); } };
    const repoCalls: Array<{ id: number; level: number; exp: bigint }> = [];
    const charRepo = {
      updateLevelAndExp: async (id: number, level: number, exp: bigint) => {
        repoCalls.push({ id, level, exp });
      },
    };
    const journalCalls: Array<{ charId: number; type: string; payload: unknown }> = [];
    const journal = { append: (e: { charId: number; type: string; payload: unknown }) => { journalCalls.push(e); } };

    const combat = new CombatService({
      // @ts-expect-error -- mock managers satisfy only the read surface
      spawnManager, zoneManager, playerManager, charRepo, journal, rng: fixedRng,
    });

    // Swing 1: mover 30 -> 15 HP (not dead); monster rages on the player.
    const r1 = combat.resolveAttack(player, mover.m_idMover);
    assert.equal(r1.ok && r1.hit, true);
    assert.equal(r1.ok && r1.killed, false);
    assert.equal(mover.m_nHitPoint, 15);
    // DAMAGE on the mover + MOVERSETDESTOBJ (rage acquire) = 2 broadcasts.
    assert.equal(broadcasts.length, 2);
    assert.equal(snapshotSubtype(broadcasts[0]), 0x0013); // SNAPSHOTTYPE_DAMAGE
    assert.equal(snapshotVictim(broadcasts[0]), mover.m_idMover);
    assert.equal(snapshotSubtype(broadcasts[1]), 0x00c2); // SNAPSHOTTYPE_MOVERSETDESTOBJ
    // Monster acquired the player as target (no inline counter-swing).
    assert.equal(mover.m_idTarget, player.m_idPlayer);
    assert.equal(mover.m_fSpeedFactor, 2.0);
    assert.equal(player.m_nHp, 200); // untouched -- AI tick swings, not combat

    // Swing 2: mover 15 -> 0 HP, dead (no re-rage -- mover is dead).
    const r2 = combat.resolveAttack(player, mover.m_idMover);
    assert.equal(r2.ok && r2.killed, true);
    assert.equal(mover.m_bDead, true);

    // + DAMAGE on the mover + MOVERDEATH = 4 broadcasts total.
    assert.equal(broadcasts.length, 4);
    assert.equal(snapshotSubtype(broadcasts[3]), 0x00c7); // SNAPSHOTTYPE_MOVERDEATH

    // Exp granted (2 * 1.0 mult), WAL-journaled (absolute CHAR_EXP) before ack, persisted.
    assert.equal(player.m_nExp, 2);
    assert.equal(journalCalls.length, 1);
    assert.equal(journalCalls[0].type, 'CHAR_EXP');
    assert.equal((journalCalls[0].payload as { exp: string }).exp, '2', 'absolute cumulative exp in payload');
    assert.equal(repoCalls.length, 1);
    assert.equal(repoCalls[0].exp, 2n);

    // SETEXPERIENCE sent to self.
    assert.equal(sends.length, 1);

    // Mover removed from the spawn table.
    assert.equal(killCalled, true);
    void PACKETTYPE;
  });

  it('rejects a non-attackable (guard, non-PK player) target', () => {
    const socket = { write: () => true };
    const player = CPlayer.fromRow(makeRow(), socket);
    player.m_nZoneId = 1;
    const guard = CMover.spawn(
      0x40000001,
      { modelIndex: 99, name: 'Guard', level: 10, hp: 1000, attackable: false, guard: true, expValue: 0 },
      { x: 0, y: 0, z: 0 }, 1,
    );
    const spawnManager = { get: () => guard, kill: () => {} };
    const zoneManager = { broadcastAround: () => 0 };
    const playerManager = { sendTo: () => {} };
    const charRepo = { updateLevelAndExp: async () => {} };
    const combat = new CombatService({
      // @ts-expect-error -- mock managers satisfy only the read surface
      spawnManager, zoneManager, playerManager, charRepo, rng: fixedRng,
    });
    const r = combat.resolveAttack(player, guard.m_idMover);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.reason, 'target_not_attackable');
  });

  it('does not re-rage (no second MOVERSETDESTOBJ) while already chasing', () => {
    const socket = { write: () => true };
    const player = CPlayer.fromRow(makeRow(), socket);
    player.m_nZoneId = 1;
    const mover = CMover.spawn(
      0x40000002,
      { modelIndex: 20, name: 'Aibatt', level: 1, hp: 30, atkMin: 16, atkMax: 16, armor: 3, hr: 40, er: 3, expValue: 0 },
      { x: 0, y: 0, z: 0 }, 1,
    );
    // Already chasing someone else -> triggerRage early-outs.
    mover.m_idTarget = 0x7fffffff;
    const spawnManager = { get: () => mover, kill: () => {} };
    const broadcasts: Buffer[] = [];
    const zoneManager = { broadcastAround: (_p: unknown, _z: number, _r: number, buf: Buffer) => { broadcasts.push(buf); return 1; } };
    const playerManager = { sendTo: () => {} };
    const charRepo = { updateLevelAndExp: async () => {} };
    const combat = new CombatService({
      // @ts-expect-error -- mock managers satisfy only the read surface
      spawnManager, zoneManager, playerManager, charRepo, rng: fixedRng,
    });

    combat.resolveAttack(player, mover.m_idMover);
    // Only the mover DAMAGE -- no MOVERSETDESTOBJ (already had a target).
    assert.equal(broadcasts.length, 1);
    assert.equal(snapshotSubtype(broadcasts[0]), 0x0013);
    assert.equal(snapshotVictim(broadcasts[0]), mover.m_idMover);
    assert.equal(mover.m_idTarget, 0x7fffffff, 'target unchanged');
    assert.equal(player.m_nHp, 200); // untouched
  });

  it('ONEKILL (/ok) mode one-shots a full-HP mover in a single swing', () => {
    const socket = { write: () => true };
    const player = CPlayer.fromRow(makeRow(), socket);
    player.m_nZoneId = 1;
    player.m_vPos = { x: 0, y: 0, z: 0 };
    player.m_dwMode = MODE.ONEKILL; // /ok active

    const mover = CMover.spawn(
      0x40000010,
      { modelIndex: 20, name: 'Tank', level: 1, hp: 5000, atkMin: 0, atkMax: 0, armor: 0, hr: 0, er: 0, expValue: 2 },
      { x: 0, y: 0, z: 0 }, 1,
    );
    const spawns = new Map([[mover.m_idMover, mover]]);
    const spawnManager = { get: (id: number) => spawns.get(id), kill: () => {} };
    const broadcasts: Buffer[] = [];
    const zoneManager = { broadcastAround: (_p: unknown, _z: number, _r: number, buf: Buffer) => { broadcasts.push(buf); return 1; } };
    const playerManager = { sendTo: () => {} };
    const charRepo = { updateLevelAndExp: async () => {} };
    const journal = { append: () => {} };
    const combat = new CombatService({
      // @ts-expect-error -- mock managers satisfy only the read surface
      spawnManager, zoneManager, playerManager, charRepo, journal, rng: fixedRng,
    });

    const r = combat.resolveAttack(player, mover.m_idMover);
    assert.equal(r.ok && r.killed, true, 'one-shot kill');
    assert.equal(mover.m_nHitPoint, 0, 'full 5000 HP gone in one swing');
    assert.equal(mover.m_bDead, true);
  });
});

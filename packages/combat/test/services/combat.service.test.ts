/**
 * CombatService integration test -- proves the wiring: a swing broadcasts
 * DAMAGE, a lethal blow broadcasts MOVERDEATH + grants exp (WAL-journaled) +
 * removes the mover. Uses a deterministic `Rng` (always-hit, fixed damage) and
 * in-memory mock managers.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CombatService } from '../../src/services/combat.service';
import type { Rng } from '../../src/combat/formulas';
import { CPlayer } from '@flyff/entities';
import type { CharacterRow } from '@flyff/database';
import { CMover } from '@flyff/entities';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { MODE } from '@flyff/entities';
import type { SkillDefinition } from '@flyff/resources';

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

/**
 * A FRESH always-hit rng. `fixedRng` above is module-level and its `int`
 * sequence carries across tests, so any test whose assertions depend on landing
 * a specific hit must own its own instance.
 */
function makeRng(): Rng {
  const seq = [0, 99, 50];
  let i = 0;
  return { int: () => seq[i++ % seq.length], range: () => 16 };
}

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
    // Dealing damage stamps the attacker's combat cursor so stand regen pauses
    // for 10 s (RecoverySystem gate -- fighting = no regen).
    assert.ok(player.m_tmLastDamage > 0, 'attacker combat cursor stamped on dealt damage');

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

  it('partyExp seam: when party handles the kill, solo grant is skipped', () => {
    // Same setup as the happy-path test, but with a partyExp seam that claims
    // the kill. The solo grantExpAmount path (WAL + SETEXPERIENCE + persist)
    // must NOT run -- the party service applied each member's exp itself.
    const writes: Buffer[] = [];
    const socket = { write: (b: Buffer) => { writes.push(b); return true; } };
    const player = CPlayer.fromRow(makeRow(), socket);
    player.m_nZoneId = 1;
    const mover = CMover.spawn(
      0x40000040,
      { modelIndex: 20, name: 'Aibatt', level: 1, hp: 30, atkMin: 16, atkMax: 16, armor: 3, hr: 40, er: 3, expValue: 2 },
      { x: 0, y: 0, z: 0 }, 1,
    );
    const spawns = new Map([[mover.m_idMover, mover]]);
    const spawnManager = { get: (id: number) => spawns.get(id), kill: () => {} };
    const zoneManager = { broadcastAround: () => 1 };
    const sends: Buffer[] = [];
    const playerManager = { sendTo: (_p: unknown, buf: Buffer) => { sends.push(buf); } };
    const repoCalls: Array<{ id: number; level: number; exp: bigint }> = [];
    const charRepo = { updateLevelAndExp: async (id: number, level: number, exp: bigint) => { repoCalls.push({ id, level, exp }); } };
    const journalCalls: Array<{ charId: number; type: string; payload: unknown }> = [];
    const journal = { append: (e: { charId: number; type: string; payload: unknown }) => { journalCalls.push(e); } };
    let partyCalls = 0;
    const combat = new CombatService({
      // @ts-expect-error -- mock managers satisfy only the read surface
      spawnManager, zoneManager, playerManager, charRepo, journal, rng: fixedRng,
      partyExp: (_k, _m, baseExp) => { partyCalls++; return baseExp > 0 ? 2 : 0; },
    });

    // Two swings: 30 -> 15 -> 0 (dead). grantExp fires on the killing blow only.
    combat.resolveAttack(player, mover.m_idMover);
    combat.resolveAttack(player, mover.m_idMover);
    assert.equal(partyCalls, 1, 'partyExp seam invoked once on kill');
    // Solo grant path skipped: no WAL, no SETEXPERIENCE, no repo persist.
    assert.equal(journalCalls.length, 0);
    assert.equal(sends.length, 0);
    assert.equal(repoCalls.length, 0);
    assert.equal(player.m_nExp, 0, 'solo exp untouched');
  });

  it('partyExp seam: when party returns null/0, solo grant runs unchanged', () => {
    const writes: Buffer[] = [];
    const socket = { write: (b: Buffer) => { writes.push(b); return true; } };
    const player = CPlayer.fromRow(makeRow(), socket);
    player.m_nZoneId = 1;
    const mover = CMover.spawn(
      0x40000041,
      { modelIndex: 20, name: 'Aibatt', level: 1, hp: 30, atkMin: 16, atkMax: 16, armor: 3, hr: 40, er: 3, expValue: 2 },
      { x: 0, y: 0, z: 0 }, 1,
    );
    const spawns = new Map([[mover.m_idMover, mover]]);
    const spawnManager = { get: (id: number) => spawns.get(id), kill: () => {} };
    const zoneManager = { broadcastAround: () => 1 };
    const sends: Buffer[] = [];
    const playerManager = { sendTo: (_p: unknown, buf: Buffer) => { sends.push(buf); } };
    const charRepo = { updateLevelAndExp: async () => {} };
    const journal = { append: () => {} };
    let partyCalls = 0;
    const combat = new CombatService({
      // @ts-expect-error -- mock managers satisfy only the read surface
      spawnManager, zoneManager, playerManager, charRepo, journal, rng: fixedRng,
      partyExp: () => { partyCalls++; return null; }, // killer has no party
    });

    combat.resolveAttack(player, mover.m_idMover);
    combat.resolveAttack(player, mover.m_idMover);
    assert.equal(partyCalls, 1, 'seam invoked on kill');
    assert.equal(player.m_nExp, 2, 'solo grant ran unchanged');
    assert.equal(sends.length, 1, 'SETEXPERIENCE sent');
  });

  it('hit-share: a helper who out-damaged the killer takes the bigger cut', () => {
    // Killer (id 1) lands 1/4 of the damage; helper (id 2) lands 3/4. The kill's
    // exp must split 25/75, not 100/0 to whoever landed the last blow.
    // Level 30 Mercenary (class 1): nLimitExp is 2083 (above the 300 share) and
    // the next level needs 57035, so neither side levels or clamps mid-assert.
    // Class must NOT be 0 -- Vagrant's jobLevelCap is 15, which discards all exp.
    const player = CPlayer.fromRow(makeRow({ level: 30, class: 1 }), { write: () => true });
    player.m_nZoneId = 1; player.m_vPos = { x: 0, y: 0, z: 0 };
    const helper = CPlayer.fromRow(makeRow({ id: 2, name: 'Helper', level: 30, class: 1 }), { write: () => true });
    helper.m_nZoneId = 1; helper.m_vPos = { x: 0, y: 0, z: 0 };

    const mover = CMover.spawn(
      0x40000050,
      { modelIndex: 20, name: 'Aibatt', level: 30, hp: 15, atkMin: 1, atkMax: 1, armor: 0, hr: 40, er: 3, expValue: 400 },
      { x: 0, y: 0, z: 0 }, 1,
    );
    // Pre-seed the helper's damage so the killer's single 15-damage swing is the
    // last quarter of a 60-damage fight.
    mover.m_idEnemies.set(helper.m_idPlayer, 45);

    const players = new Map([[1, player], [2, helper]]);
    const combat = new CombatService({
      // @ts-expect-error -- mock managers satisfy only the read surface
      spawnManager: { get: () => mover, kill: () => {} },
      zoneManager: { broadcastAround: () => 1 },
      playerManager: { get: (id: number) => players.get(id), sendTo: () => {} },
      charRepo: { updateLevelAndExp: async () => {} },
      rng: makeRng(),
    });

    combat.resolveAttack(player, mover.m_idMover);
    // 400 raw; killer share = 400 * 15/60 = 100, helper = 400 * 45/60 = 300.
    // mover level == player level -> 1.0x solo multiplier, no cap hit.
    assert.equal(player.m_nExp, 100, 'killer paid for 1/4 of the damage');
    assert.equal(helper.m_nExp, 300, 'helper paid for 3/4 of the damage');
  });

  it('hit-share: an out-of-range attacker forfeits their cut', () => {
    const player = CPlayer.fromRow(makeRow({ level: 30, class: 1 }), { write: () => true });
    player.m_nZoneId = 1; player.m_vPos = { x: 0, y: 0, z: 0 };
    const runner = CPlayer.fromRow(makeRow({ id: 2, name: 'Runner', level: 30, class: 1 }), { write: () => true });
    runner.m_nZoneId = 1; runner.m_vPos = { x: 500, y: 0, z: 0 }; // way past 64m

    const mover = CMover.spawn(
      0x40000051,
      { modelIndex: 20, name: 'Aibatt', level: 30, hp: 15, atkMin: 1, atkMax: 1, armor: 0, hr: 40, er: 3, expValue: 400 },
      { x: 0, y: 0, z: 0 }, 1,
    );
    mover.m_idEnemies.set(runner.m_idPlayer, 45);
    const players = new Map([[1, player], [2, runner]]);
    const combat = new CombatService({
      // @ts-expect-error -- mock managers satisfy only the read surface
      spawnManager: { get: () => mover, kill: () => {} },
      zoneManager: { broadcastAround: () => 1 },
      playerManager: { get: (id: number) => players.get(id), sendTo: () => {} },
      charRepo: { updateLevelAndExp: async () => {} },
      rng: makeRng(),
    });

    combat.resolveAttack(player, mover.m_idMover);
    // The runner's 3/4 is NOT redistributed -- the killer still gets only their
    // own 1/4 (C++ divides by dwMaxEnemyHit, which includes the forfeited hits).
    assert.equal(player.m_nExp, 100);
    assert.equal(runner.m_nExp, 0, 'out of range = no exp');
  });

  it('hit-share: co-party attackers pool into ONE party share', () => {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_nZoneId = 1; player.m_vPos = { x: 0, y: 0, z: 0 };
    const mate = CPlayer.fromRow(makeRow({ id: 2, name: 'Mate' }), { write: () => true });
    mate.m_nZoneId = 1; mate.m_vPos = { x: 0, y: 0, z: 0 };

    const mover = CMover.spawn(
      0x40000052,
      { modelIndex: 20, name: 'Aibatt', level: 1, hp: 15, atkMin: 1, atkMax: 1, armor: 0, hr: 40, er: 3, expValue: 400 },
      { x: 0, y: 0, z: 0 }, 1,
    );
    mover.m_idEnemies.set(mate.m_idPlayer, 45);
    const players = new Map([[1, player], [2, mate]]);
    const partyShares: number[] = [];
    const combat = new CombatService({
      // @ts-expect-error -- mock managers satisfy only the read surface
      spawnManager: { get: () => mover, kill: () => {} },
      zoneManager: { broadcastAround: () => 1 },
      playerManager: { get: (id: number) => players.get(id), sendTo: () => {} },
      charRepo: { updateLevelAndExp: async () => {} },
      rng: makeRng(),
      sameParty: () => true,
      partyExp: (_k, _m, share) => { partyShares.push(share); return 2; },
    });

    combat.resolveAttack(player, mover.m_idMover);
    // ONE call carrying the WHOLE kill (15 + 45 of 60), not two calls of 100/300.
    assert.deepEqual(partyShares, [400]);
    assert.equal(player.m_nExp, 0, 'party service owns the grant');
    assert.equal(mate.m_nExp, 0);
  });

  it('hit-share: pooled party share falls back to a solo grant when the split declines', () => {
    // Regression: Phase 2 used to ignore the seam's return value, so a `null`
    // (split does not apply -- fewer than 2 members within 64m of the
    // REPRESENTATIVE) dropped the whole pooled share and NOBODY was paid.
    // C++ AddExperienceKillMember calls AddExperienceSolo(..., bParty=TRUE)
    // on that branch (Mover.cpp:6367).
    const player = CPlayer.fromRow(makeRow({ level: 30, class: 1 }), { write: () => true });
    player.m_nZoneId = 1; player.m_vPos = { x: 0, y: 0, z: 0 };
    const mate = CPlayer.fromRow(makeRow({ id: 2, name: 'Mate', level: 30, class: 1 }), { write: () => true });
    mate.m_nZoneId = 1; mate.m_vPos = { x: 0, y: 0, z: 0 };

    const mover = CMover.spawn(
      0x40000053,
      { modelIndex: 20, name: 'Aibatt', level: 30, hp: 15, atkMin: 1, atkMax: 1, armor: 0, hr: 40, er: 3, expValue: 400 },
      { x: 0, y: 0, z: 0 }, 1,
    );
    mover.m_idEnemies.set(mate.m_idPlayer, 45);
    const players = new Map([[1, player], [2, mate]]);
    const partyShares: number[] = [];
    const combat = new CombatService({
      // @ts-expect-error -- mock managers satisfy only the read surface
      spawnManager: { get: () => mover, kill: () => {} },
      zoneManager: { broadcastAround: () => 1 },
      playerManager: { get: (id: number) => players.get(id), sendTo: () => {} },
      charRepo: { updateLevelAndExp: async () => {} },
      rng: makeRng(),
      sameParty: () => true,
      // Pooling happens (both are "same party"), but the split declines.
      partyExp: (_k, _m, share) => { partyShares.push(share); return null; },
    });

    combat.resolveAttack(player, mover.m_idMover);
    assert.deepEqual(partyShares, [400], 'seam still consulted with the pooled share');
    // The representative is the FIRST entry in `m_idEnemies` insertion order --
    // here `mate`, seeded before the killer's own hit is recorded. That is the
    // player C++ runs `GetPartyMemberFind` from, and the one the fallback pays.
    assert.equal(mate.m_nExp, 400, 'pooled share falls back to the representative');
    assert.equal(player.m_nExp, 0, 'the non-representative is not separately paid');
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

describe('CombatService.resolveSkill — multi-hit (nSkillCount)', () => {
  /** Skill rng: range→min damage, int→99 (no crit). */
  const skillRng: Rng = { int: () => 99, range: (lo: number) => lo };

  async function loadCleanHit() {
    const { loadSkills } = await import('@flyff/resources');
    const { resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const dir = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../resources/data');
    const idx = await loadSkills(dir);
    const skill = idx.skills.get(1);
    if (!skill) throw new Error('Clean Hit (id=1) not loaded');
    return skill;
  }

  function makeCombat(mover: CMover) {
    const player = CPlayer.fromRow(makeRow(), { write: () => true });
    player.m_nZoneId = 1;
    player.m_vPos = { x: 0, y: 0, z: 0 };
    const spawns = new Map([[mover.m_idMover, mover]]);
    const broadcasts: Buffer[] = [];
    const sends: Buffer[] = [];
    const journalCalls: Array<{ type: string }> = [];
    const combat = new CombatService({
      // @ts-expect-error -- mock managers satisfy only the read surface
      spawnManager: { get: (id: number) => spawns.get(id), kill: () => {} },
      zoneManager: { broadcastAround: (_p: unknown, _z: number, _r: number, b: Buffer) => { broadcasts.push(b); return 1; } },
      playerManager: { sendTo: (_p: unknown, b: Buffer) => { sends.push(b); } },
      charRepo: { updateLevelAndExp: async () => {} },
      journal: { append: (e: { type: string }) => { journalCalls.push(e); } },
      rng: skillRng,
    });
    return { player, combat, broadcasts, sends, journalCalls };
  }

  const MOVER_OPTS = { modelIndex: 20, name: 'Aibatt', level: 1, atkMin: 16, atkMax: 16, armor: 3, hr: 40, er: 3, expValue: 2 };

  /** Count DAMAGE snapshots in the broadcast list (excludes rage/death side-broadcasts). */
  const countDamage = (bufs: Buffer[]) => bufs.filter((b) => snapshotSubtype(b) === 0x0013).length;

  /** Measure one hit's damage on a throwaway 200-HP mover so multi-hit asserts
   *  don't hardcode the bare-fist ATK floor (which varies with BARE_EQUIP). */
  async function perHitDamage(skill: SkillDefinition) {
    const level = skill.levels[0]!;
    const mover = CMover.spawn(0x40000090, { ...MOVER_OPTS, hp: 200 }, { x: 0, y: 0, z: 0 }, 1);
    const { player, combat } = makeCombat(mover);
    combat.resolveSkill(player, mover.m_idMover, skill, level);
    return 200 - mover.m_nHitPoint;
  }

  it('single-hit (skillCount absent) applies one DAMAGE', async () => {
    const skill = await loadCleanHit();
    const level = skill.levels[0]!;
    const perHit = await perHitDamage(skill);
    const mover = CMover.spawn(0x40000001, { ...MOVER_OPTS, hp: 200 }, { x: 0, y: 0, z: 0 }, 1);
    const { player, combat, broadcasts } = makeCombat(mover);
    const r = combat.resolveSkill(player, mover.m_idMover, skill, level);
    assert.equal(r.ok && r.hit, true);
    assert.equal(r.ok && r.killed, false);
    assert.equal(mover.m_nHitPoint, 200 - perHit);
    assert.equal(countDamage(broadcasts), 1, 'one DAMAGE snapshot');
  });

  it('multi-hit (skillCount 3) applies 3 separate DAMAGE snapshots + 1/3 damage each', async () => {
    const skill = await loadCleanHit();
    const level = { ...skill.levels[0]!, skillCount: 3 };
    const baseDamage = await perHitDamage(skill);
    const perHitDivided = Math.floor(baseDamage / 3); // C++ MoverAttack.cpp:925 -- factor /= nSkillCount
    const mover = CMover.spawn(0x40000002, { ...MOVER_OPTS, hp: 200 }, { x: 0, y: 0, z: 0 }, 1);
    const { player, combat, broadcasts, journalCalls } = makeCombat(mover);
    const r = combat.resolveSkill(player, mover.m_idMover, skill, level);
    assert.equal(r.ok && r.killed, false);
    assert.equal(countDamage(broadcasts), 3, 'three DAMAGE snapshots (one per hit)');
    assert.equal(mover.m_nHitPoint, 200 - perHitDivided * 3, 'each hit deals 1/3 base damage');
    assert.equal(journalCalls.length, 0, 'not dead → no exp journal');
  });

  it('stops the chain when the target dies mid-hit (no double death/exp)', async () => {
    const skill = await loadCleanHit();
    const level = { ...skill.levels[0]!, skillCount: 3 };
    const baseDamage = await perHitDamage(skill);
    const perHitDivided = Math.floor(baseDamage / 3);
    // HP exactly perHitDivided → hit 1 lethal; hits 2-3 must be skipped.
    const mover = CMover.spawn(0x40000003, { ...MOVER_OPTS, hp: perHitDivided }, { x: 0, y: 0, z: 0 }, 1);
    const { player, combat, broadcasts, journalCalls } = makeCombat(mover);
    const r = combat.resolveSkill(player, mover.m_idMover, skill, level);
    assert.equal(r.ok && r.killed, true);
    assert.equal(mover.m_bDead, true);
    assert.equal(mover.m_nHitPoint, 0);
    // Exactly one DAMAGE + one MOVERDEATH — no duplicate death broadcast.
    assert.equal(countDamage(broadcasts), 1, 'only hit 1 lands');
    assert.equal(broadcasts.some((b) => snapshotSubtype(b) === 0x00c7), true, 'MOVERDEATH broadcast');
    assert.equal(journalCalls.length, 1, 'exp granted exactly once (no double-death)');
  });
});

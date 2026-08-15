import { describe, it, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import type { SpawnManager } from '@flyff/world-core';
import type { ZoneManager } from '@flyff/world-core';
import { CMover } from '@flyff/entities';
import { CPlayer } from '@flyff/entities';
import type { MoverSpawnSource } from '@flyff/entities';
import type { Vec3 } from '@flyff/entities';
import type { CharacterRow } from '@flyff/database';
import { AISystem } from '../../src/systems/ai.system';
import { MODE, RUNAWAY_DELAY_MS } from '@flyff/entities';

/** Minimal CharacterRow for a live player at `id`. */
function makeRow(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 1, account_id: 1, name: 'P', slot: 0, class: 0, gender: 0,
    hair_style: 0, hair_color: 0, face_style: 0, skin_color: 0,
    level: 1, exp: 0n, hp: 200, mp: 100, max_hp: 200, max_mp: 100,
    strength: 15, stamina: 15, dexterity: 15, intelligence: 15,
    x: 0, y: 0, z: 0, world_id: 'flaris', zone_id: 1,
    created_at: new Date(), updated_at: new Date(),
    ...over,
  };
}

/** Captured broadcast: the unframed DESTPOS buffer + the filter args. */
interface Cast {
  pos: Vec3;
  zoneId: number;
  packet: Buffer;
}

/** Minimal mover source for an aggressive wandering monster. */
function monsterSrc(): MoverSpawnSource {
  return {
    modelIndex: 20, name: 'Aibatt', level: 1, hp: 100,
    attackable: true, guard: false, belligerence: 6,
  };
}

/** Spawn a mover at `pos` (anchor = pos) in zone 1. */
function makeMover(id: number, pos: Vec3): CMover {
  const m = CMover.spawn(id, monsterSrc(), pos, 1);
  return m;
}

/** ZoneManager stub that records every broadcastAround call. */
function makeZone(casts: Cast[], players: CPlayer[] = []): ZoneManager {
  return {
    broadcastAround(pos: Vec3, zoneId: number, _r: number, packet: Buffer): number {
      casts.push({ pos: { ...pos }, zoneId, packet });
      return 1;
    },
    playersNear(_p: Vec3, _z: number, _r: number): CPlayer[] { return players; },
  } as unknown as ZoneManager;
}

/** SpawnManager stub yielding a fixed live-mover list. */
function makeSpawn(movers: CMover[]): SpawnManager {
  return { all: function* () { yield* movers; } } as unknown as SpawnManager;
}

/** PlayerManager stub with a fixed live-player table. */
function makePlayers(map: Map<number, CPlayer>): { get(id: number): CPlayer | undefined } {
  return { get: (id: number) => map.get(id) };
}

/** Subtype WORD at offset 14 of an unframed snapshot payload. */
function subtypeOf(buf: Buffer): number {
  return buf.readUInt16LE(14);
}

/** Parse objid + dest (x,z) out of a raw DESTPOS payload built by DestPosSerializer. */
function parseDest(buf: Buffer): { objid: number; x: number; z: number } {
  return {
    objid: buf.readUInt32LE(10),
    x: buf.readFloatLE(16),
    z: buf.readFloatLE(24),
  };
}

describe('AISystem (idle wander)', () => {
  it('stagger-seeds m_tmNextWander on first tick and emits no broadcast', () => {
    const casts: Cast[] = [];
    const m = makeMover(0x40000000, { x: 1000, y: 0, z: 1000 });
    assert.equal(m.m_tmNextWander, 0);
    const ai = new AISystem({ spawnManager: makeSpawn([m]), zoneManager: makeZone(casts), playerManager: makePlayers(new Map()) });
    ai.tick(10_000);
    assert.equal(casts.length, 0, 'no broadcast on stagger seed');
    assert.ok(m.m_tmNextWander > 10_000 && m.m_tmNextWander <= 10_000 + 5000);
  });

  it('picks a dest within the +/-10 wander box and broadcasts DESTPOS', () => {
    const casts: Cast[] = [];
    const m = makeMover(0x40000001, { x: 1000, y: 0, z: 1000 });
    m.m_tmNextWander = 1000; // due now
    const ai = new AISystem({ spawnManager: makeSpawn([m]), zoneManager: makeZone(casts), playerManager: makePlayers(new Map()) });
    ai.tick(1000);
    assert.equal(casts.length, 1);
    const d = parseDest(casts[0]!.packet);
    assert.equal(d.objid, m.m_idMover);
    assert.ok(d.x >= 990 && d.x <= 1010, `x=${d.x} inside +/-10 box`);
    assert.ok(d.z >= 990 && d.z <= 1010, `z=${d.z} inside +/-10 box`);
    // 5-6 s until next pick.
    assert.ok(m.m_tmNextWander >= 1000 + 5000 && m.m_tmNextWander <= 1000 + 6000);
    // Server logical pos snapped to the broadcast dest.
    assert.equal(m.m_vPos.x, d.x);
    assert.equal(m.m_vPos.z, d.z);
  });

  it('skips a pick that would leave the 30 m leash (no broadcast, next wander set)', () => {
    const casts: Cast[] = [];
    // Anchor far from origin; place monster at the leash edge so any +10 box
    // pick outward exceeds RANGE_MOVE while the monster itself stays inside.
    const anchor: Vec3 = { x: 0, y: 0, z: 0 };
    const m = makeMover(0x40000002, anchor);
    m.m_vPos = { x: 29, y: 0, z: 0 }; // inside leash (29 < 30)...
    m.m_tmNextWander = 1000;
    // ...but force every pick outward (+10) so dest exits the leash.
    mock.method(Math, 'random', () => 0.9999);
    const ai = new AISystem({ spawnManager: makeSpawn([m]), zoneManager: makeZone(casts), playerManager: makePlayers(new Map()) });
    ai.tick(1000);
    assert.equal(casts.length, 0, 'outward pick suppressed');
    assert.ok(m.m_tmNextWander > 1000, 'next wander rescheduled');
    mock.restoreAll();
  });

  it('snaps home + broadcasts when already outside the leash', () => {
    const casts: Cast[] = [];
    const anchor: Vec3 = { x: 500, y: 0, z: 500 };
    const m = makeMover(0x40000003, anchor);
    m.m_vPos = { x: 600, y: 0, z: 600 }; // 141 m from anchor -- well outside
    m.m_tmNextWander = 1000;
    const ai = new AISystem({ spawnManager: makeSpawn([m]), zoneManager: makeZone(casts), playerManager: makePlayers(new Map()) });
    ai.tick(1000);
    assert.equal(casts.length, 1);
    const d = parseDest(casts[0]!.packet);
    assert.equal(d.x, 500, 'dest = home x');
    assert.equal(d.z, 500, 'dest = home z');
    assert.equal(m.m_vPos.x, 500);
    assert.equal(m.m_vPos.z, 500);
  });

  it('keeps every random pick inside the 30 m leash over many ticks', () => {
    const casts: Cast[] = [];
    const anchor: Vec3 = { x: 1000, y: 0, z: 1000 };
    const m = makeMover(0x40000004, anchor);
    m.m_tmNextWander = 0;
    const ai = new AISystem({ spawnManager: makeSpawn([m]), zoneManager: makeZone(casts), playerManager: makePlayers(new Map()) });
    // Drive 50 picks with real randomness.
    let now = 0;
    for (let i = 0; i < 50; i++) {
      now = m.m_tmNextWander || now + 6000;
      ai.tick(now);
    }
    const dx = m.m_vPos.x - anchor.x;
    const dz = m.m_vPos.z - anchor.z;
    assert.ok(dx * dx + dz * dz <= 30 * 30, `stayed inside leash (dx=${dx}, dz=${dz})`);
    assert.ok(casts.length > 0, 'wandered at least once');
  });

  it('skips peaceful NPCs, guards, and dead movers', () => {
    const casts: Cast[] = [];
    const peaceful = makeMover(0x40000010, { x: 0, y: 0, z: 0 });
    peaceful.m_bAttackable = false;
    peaceful.m_tmNextWander = 1;
    const guard = makeMover(0x40000011, { x: 0, y: 0, z: 0 });
    guard.m_bGuard = true;
    guard.m_tmNextWander = 1;
    const dead = makeMover(0x40000012, { x: 0, y: 0, z: 0 });
    dead.m_bDead = true;
    dead.m_tmNextWander = 1;
    const live = makeMover(0x40000013, { x: 0, y: 0, z: 0 });
    live.m_tmNextWander = 1;
    const ai = new AISystem({
      spawnManager: makeSpawn([peaceful, guard, dead, live]),
      zoneManager: makeZone(casts),
      playerManager: makePlayers(new Map()),
    });
    ai.tick(1000);
    // Only the live monster broadcasts.
    assert.equal(casts.length, 1);
    assert.equal(parseDest(casts[0]!.packet).objid, live.m_idMover);
  });

  it('start/stop controls the timer without throwing', () => {
    const ai = new AISystem({ spawnManager: makeSpawn([]), zoneManager: makeZone([]), playerManager: makePlayers(new Map()) });
    ai.start();
    ai.start(); // idempotent
    ai.stop();
    ai.stop(); // idempotent
    assert.ok(true);
  });

  it('active BELLI sight-acquires the nearest player (MOVERSETDESTOBJ broadcast)', () => {
    const casts: Cast[] = [];
    const player = CPlayer.fromRow(makeRow({ id: 42 }), { write: () => true } as never);
    player.m_nZoneId = 1;
    player.m_vPos = { x: 1003, y: 0, z: 1000 }; // ~3 m from monster
    const m = makeMover(0x40000020, { x: 1000, y: 0, z: 1000 });
    m.m_tmNextWander = 1; // past -- due
    const ai = new AISystem({
      spawnManager: makeSpawn([m]),
      zoneManager: makeZone(casts, [player]),
      playerManager: makePlayers(new Map([[player.m_idPlayer, player]])),
    });
    ai.tick(1000);
    assert.equal(m.m_idTarget, player.m_idPlayer, 'target acquired');
    assert.equal(m.m_fSpeedFactor, 2.0, 'pursue speed');
    assert.equal(casts.length, 1);
    assert.equal(subtypeOf(casts[0]!.packet), 0x00c2, 'MOVERSETDESTOBJ');
  });

  it('derives m_bActiveAttack from belli (red-name gate): only ACTIVEATTACK* bells are active', () => {
    // BELLI_ACTIVEATTACK_MELEE (6) -> sight-aggressive -> red name.
    const active = CMover.spawn(
      0x40000050,
      { modelIndex: 20, name: 'M', level: 1, hp: 10, attackable: true, belligerence: 6 },
      { x: 0, y: 0, z: 0 }, 1,
    );
    assert.equal(active.m_bActiveAttack, 1, 'BELLI_ACTIVEATTACK_MELEE(6) -> red-name (active)');
    // BELLI_MELEE (12) is cautious-type ("counterattack WHEN attacked") -> NOT active.
    const melee = CMover.spawn(
      0x40000051,
      { modelIndex: 20, name: 'M', level: 1, hp: 10, attackable: true, belligerence: 12 },
      { x: 0, y: 0, z: 0 }, 1,
    );
    assert.equal(melee.m_bActiveAttack, 0, 'BELLI_MELEE(12) -> not red-name (cautious-type)');
    const cautious = CMover.spawn(
      0x40000052,
      { modelIndex: 20, name: 'M', level: 1, hp: 10, attackable: true, belligerence: 2 },
      { x: 0, y: 0, z: 0 }, 1,
    );
    assert.equal(cautious.m_bActiveAttack, 0, 'BELLI_CAUTIOUSATTACK -> not red-name');
    const peaceful = CMover.spawn(
      0x40000053,
      { modelIndex: 20, name: 'M', level: 1, hp: 10, attackable: false, belligerence: 1 },
      { x: 0, y: 0, z: 0 }, 1,
    );
    assert.equal(peaceful.m_bActiveAttack, 0, 'BELLI_PEACEFUL -> not red-name');
  });

  it('red-name mob does NOT sight-acquire a player beyond AGGRO_LEVEL_BAND above it', () => {
    const casts: Cast[] = [];
    const player = CPlayer.fromRow(makeRow({ id: 60, level: 30 }), { write: () => true } as never);
    player.m_nZoneId = 1;
    player.m_vPos = { x: 1003, y: 0, z: 1000 }; // ~3 m away, in SIGHT_RANGE
    const m = CMover.spawn(
      0x40000053,
      { modelIndex: 20, name: 'Low Mob', level: 5, hp: 100, attackable: true, belligerence: 6 },
      { x: 1000, y: 0, z: 1000 }, 1,
    );
    m.m_tmNextWander = 100_000; // suppress idle wander so casts stay clean
    const ai = new AISystem({
      spawnManager: makeSpawn([m]),
      zoneManager: makeZone(casts, [player]),
      playerManager: makePlayers(new Map([[player.m_idPlayer, player]])),
    });
    ai.tick(1000);
    assert.equal(m.m_idTarget, 0xffffffff, 'out-leveled player not aggrod');
    assert.equal(casts.length, 0, 'no acquire broadcast');
  });

  it('red-name mob sight-acquires a player within AGGRO_LEVEL_BAND', () => {
    const casts: Cast[] = [];
    // mob level 5, player level 14 -> 14 <= 5+9 -> eligible.
    const player = CPlayer.fromRow(makeRow({ id: 61, level: 14 }), { write: () => true } as never);
    player.m_nZoneId = 1;
    player.m_vPos = { x: 1003, y: 0, z: 1000 };
    const m = CMover.spawn(
      0x40000054,
      { modelIndex: 20, name: 'Mob', level: 5, hp: 100, attackable: true, belligerence: 6 },
      { x: 1000, y: 0, z: 1000 }, 1,
    );
    m.m_tmNextWander = 100_000;
    const ai = new AISystem({
      spawnManager: makeSpawn([m]),
      zoneManager: makeZone(casts, [player]),
      playerManager: makePlayers(new Map([[player.m_idPlayer, player]])),
    });
    ai.tick(1000);
    assert.equal(m.m_idTarget, player.m_idPlayer, 'in-band player aggrod');
    assert.equal(subtypeOf(casts[0]!.packet), 0x00c2, 'MOVERSETDESTOBJ');
  });

  it('TRANSPARENT (/inv) player is never sight-acquired', () => {
    const casts: Cast[] = [];
    const player = CPlayer.fromRow(makeRow({ id: 70, level: 5 }), { write: () => true } as never);
    player.m_nZoneId = 1;
    player.m_vPos = { x: 1003, y: 0, z: 1000 }; // ~3 m away, in band
    player.m_dwMode = MODE.TRANSPARENT; // /inv active
    const m = CMover.spawn(
      0x40000060,
      { modelIndex: 20, name: 'Mob', level: 5, hp: 100, attackable: true, belligerence: 6 },
      { x: 1000, y: 0, z: 1000 }, 1,
    );
    m.m_tmNextWander = 100_000; // suppress wander so casts stay clean
    const ai = new AISystem({
      spawnManager: makeSpawn([m]),
      zoneManager: makeZone(casts, [player]),
      playerManager: makePlayers(new Map([[player.m_idPlayer, player]])),
    });
    ai.tick(1000);
    assert.equal(m.m_idTarget, 0xffffffff, 'invisible player not aggrod');
    assert.equal(casts.length, 0, 'no acquire broadcast');
  });

  it('passive mob (m_bActiveAttack unset) never sight-acquires, any level', () => {
    const casts: Cast[] = [];
    const player = CPlayer.fromRow(makeRow({ id: 62, level: 1 }), { write: () => true } as never);
    player.m_nZoneId = 1;
    player.m_vPos = { x: 1003, y: 0, z: 1000 };
    const m = CMover.spawn(
      0x40000055,
      { modelIndex: 20, name: 'Cautious', level: 1, hp: 100, attackable: true, belligerence: 2 },
      { x: 1000, y: 0, z: 1000 }, 1,
    );
    assert.equal(m.m_bActiveAttack, 0, 'cautious belli -> not red-name');
    m.m_tmNextWander = 100_000;
    const ai = new AISystem({
      spawnManager: makeSpawn([m]),
      zoneManager: makeZone(casts, [player]),
      playerManager: makePlayers(new Map([[player.m_idPlayer, player]])),
    });
    ai.tick(1000);
    assert.equal(m.m_idTarget, 0xffffffff, 'passive mob does not sight-aggro');
    assert.equal(casts.length, 0, 'no acquire broadcast');
  });

  it('pursue steps toward the player and swings when in melee range', () => {
    const casts: Cast[] = [];
    const player = CPlayer.fromRow(makeRow({ id: 7, hp: 200, max_hp: 200 }), { write: () => true } as never);
    player.m_nZoneId = 1;
    player.m_vPos = { x: 2, y: 0, z: 0 }; // within 3 m melee range
    const m = makeMover(0x40000021, { x: 0, y: 0, z: 0 });
    m.m_fSpeedBase = 0.075;
    m.m_nAtkMin = 16; m.m_nAtkMax = 16; m.m_nHR = 40;
    m.m_idTarget = player.m_idPlayer; // already raged
    m.m_nextAttackTick = 0; // ready to swing
    const ai = new AISystem({
      spawnManager: makeSpawn([m]),
      zoneManager: makeZone(casts),
      playerManager: makePlayers(new Map([[player.m_idPlayer, player]])),
      rng: { int: (() => { const s = [0, 99, 50]; let i = 0; return () => s[i++ % s.length]; })(), range: () => 16 } as never,
    });
    ai.tick(1000);
    // monsterSwing -> DAMAGE on the player.
    const dmg = casts.find((c) => subtypeOf(c.packet) === 0x0013);
    assert.ok(dmg, 'player DAMAGE broadcast');
    assert.equal(dmg!.packet.readUInt32LE(10), player.m_idPlayer, 'victim = player');
    assert.ok(player.m_nHp < 200, 'player took damage');
    assert.ok(m.m_nextAttackTick > 1000, 're-attack cadence armed');
  });

  it('MATCHLESS (/undying) player takes no damage from a monster swing', () => {
    const casts: Cast[] = [];
    const player = CPlayer.fromRow(makeRow({ id: 9, hp: 200, max_hp: 200 }), { write: () => true } as never);
    player.m_nZoneId = 1;
    player.m_vPos = { x: 2, y: 0, z: 0 }; // within 3 m melee range
    player.m_dwMode = MODE.MATCHLESS; // /undying active
    const m = makeMover(0x40000021, { x: 0, y: 0, z: 0 });
    m.m_fSpeedBase = 0.075;
    m.m_nAtkMin = 16; m.m_nAtkMax = 16; m.m_nHR = 40;
    m.m_idTarget = player.m_idPlayer;
    m.m_nextAttackTick = 0;
    const ai = new AISystem({
      spawnManager: makeSpawn([m]),
      zoneManager: makeZone(casts),
      playerManager: makePlayers(new Map([[player.m_idPlayer, player]])),
      rng: { int: (() => { const s = [0, 99, 50]; let i = 0; return () => s[i++ % s.length]; })(), range: () => 16 } as never,
    });
    ai.tick(1000);
    // Swing anim still fires, DAMAGE still broadcast, but HP unchanged.
    const dmg = casts.find((c) => subtypeOf(c.packet) === 0x0013);
    assert.ok(dmg, 'player DAMAGE broadcast (swing still animates)');
    assert.equal(player.m_nHp, 200, 'MATCHLESS player lost no HP');
    assert.ok(!player._dirty.has('m_nHp'), 'no dirty flag -- HP not mutated');
  });

  it('monster drops a acquired target that goes TRANSPARENT (/inv) mid-fight', () => {
    const casts: Cast[] = [];
    const player = CPlayer.fromRow(makeRow({ id: 11, hp: 200, max_hp: 200 }), { write: () => true } as never);
    player.m_nZoneId = 1;
    player.m_vPos = { x: 2, y: 0, z: 0 };
    player.m_dwMode = MODE.TRANSPARENT; // went invisible AFTER being acquired
    const m = makeMover(0x40000022, { x: 0, y: 0, z: 0 });
    m.m_idTarget = player.m_idPlayer; // already raged before the toggle
    m.m_nextAttackTick = 0;
    const ai = new AISystem({
      spawnManager: makeSpawn([m]),
      zoneManager: makeZone(casts),
      playerManager: makePlayers(new Map([[player.m_idPlayer, player]])),
    });
    ai.tick(1000);
    assert.equal(m.m_idTarget, 0xffffffff, 'invisible target released');
    assert.equal(m.m_bReturnToBegin, true, 'monster returns home');
    // No swing landed on the vanished player.
    const dmg = casts.find((c) => subtypeOf(c.packet) === 0x0013);
    assert.equal(dmg, undefined, 'no DAMAGE on invisible target');
  });

  it('ranged monster holds at range, broadcasts RANGE_ATTACK, uses 3 s cadence', () => {
    const casts: Cast[] = [];
    const player = CPlayer.fromRow(makeRow({ id: 8, hp: 200, max_hp: 200 }), { write: () => true } as never);
    player.m_nZoneId = 1;
    player.m_vPos = { x: 8, y: 0, z: 0 }; // within 10 m range, beyond 3 m melee
    // BELLI_RANGE (13) -> constructor flags ranged + m_nAttackRange defaults to 10.
    const m = CMover.spawn(
      0x40000030,
      { modelIndex: 20, name: 'Ranger Mob', level: 1, hp: 100, attackable: true, belligerence: 13 },
      { x: 0, y: 0, z: 0 }, 1,
    );
    assert.equal(m.m_bRangeAttack, true, 'belli 13 -> ranged');
    assert.equal(m.m_nAttackRange, 10, 'default range distance');
    m.m_fSpeedBase = 0.075;
    m.m_nAtkMin = 16; m.m_nAtkMax = 16; m.m_nHR = 40;
    m.m_idTarget = player.m_idPlayer; // already raged
    m.m_nextAttackTick = 0; // ready to swing
    const startX = m.m_vPos.x;
    const ai = new AISystem({
      spawnManager: makeSpawn([m]),
      zoneManager: makeZone(casts),
      playerManager: makePlayers(new Map([[player.m_idPlayer, player]])),
      rng: { int: (() => { const s = [0, 99, 50]; let i = 0; return () => s[i++ % s.length]; })(), range: () => 16 } as never,
    });
    ai.tick(1000);
    // RANGE_ATTACK animation broadcast (0x00e2).
    const rangePkt = casts.find((c) => subtypeOf(c.packet) === 0x00e2);
    assert.ok(rangePkt, 'RANGE_ATTACK broadcast');
    assert.equal(rangePkt!.packet.readUInt32LE(10), m.m_idMover, 'attacker = monster');
    // DAMAGE on the player.
    const dmg = casts.find((c) => subtypeOf(c.packet) === 0x0013);
    assert.ok(dmg, 'player DAMAGE broadcast');
    assert.ok(player.m_nHp < 200, 'player took damage');
    // Held at range -- did NOT step toward the player (already within 10 m).
    assert.equal(m.m_vPos.x, startX, 'ranged monster holds position');
    // Range cadence = fixed 3 s.
    assert.equal(m.m_nextAttackTick, 1000 + 3000, 'range re-attack cadence');
  });

  it('ranged monster closes the gap until within attack range, then holds', () => {
    const casts: Cast[] = [];
    const player = CPlayer.fromRow(makeRow({ id: 9, hp: 200, max_hp: 200 }), { write: () => true } as never);
    player.m_nZoneId = 1;
    player.m_vPos = { x: 20, y: 0, z: 0 }; // beyond 10 m range
    const m = CMover.spawn(
      0x40000031,
      { modelIndex: 20, name: 'Ranger Mob', level: 1, hp: 100, attackable: true, belligerence: 13 },
      { x: 0, y: 0, z: 0 }, 1,
    );
    m.m_fSpeedBase = 0.075;
    m.m_nAtkMin = 16; m.m_nAtkMax = 16; m.m_nHR = 40;
    m.m_idTarget = player.m_idPlayer;
    m.m_nextAttackTick = 0;
    const ai = new AISystem({
      spawnManager: makeSpawn([m]),
      zoneManager: makeZone(casts),
      playerManager: makePlayers(new Map([[player.m_idPlayer, player]])),
      rng: { int: () => 0, range: () => 16 } as never,
    });
    ai.tick(1000); // dt 100 ms -- step toward but not yet in range
    // No swing yet (still out of range) -- no DAMAGE, no RANGE_ATTACK.
    assert.ok(!casts.find((c) => subtypeOf(c.packet) === 0x0013), 'no DAMAGE while closing');
    assert.ok(m.m_vPos.x > 0, 'stepped toward the player');
  });

  it('leashes home when the target drags the monster past 150 m from spawn', () => {
    const casts: Cast[] = [];
    const player = CPlayer.fromRow(makeRow({ id: 8, hp: 200, max_hp: 200 }), { write: () => true } as never);
    player.m_nZoneId = 1;
    player.m_vPos = { x: 200, y: 0, z: 0 };
    const m = makeMover(0x40000022, { x: 0, y: 0, z: 0 }); // anchor at origin
    m.m_fSpeedBase = 0.075;
    m.m_vPos = { x: 160, y: 0, z: 0 }; // > 150 m from anchor -> leashed
    m.m_idTarget = player.m_idPlayer;
    const ai = new AISystem({
      spawnManager: makeSpawn([m]),
      zoneManager: makeZone(casts),
      playerManager: makePlayers(new Map([[player.m_idPlayer, player]])),
    });
    ai.tick(1000);
    assert.equal(m.m_idTarget, 0xffffffff, 'target cleared');
    assert.equal(m.m_bReturnToBegin, true, 'returning home');
    assert.equal(m.m_fSpeedFactor, 2.66, 'return speed');
  });

  it('drops the target on arrival home; HP is restored to max (v19 silent heal)', () => {
    const casts: Cast[] = [];
    const m = makeMover(0x40000023, { x: 500, y: 0, z: 500 });
    m.m_fSpeedBase = 0.075;
    m.m_vPos = { x: 502, y: 0, z: 502 }; // ~2.8 m from anchor < HOME_ARRIVAL 7
    m.m_bReturnToBegin = true;
    m.m_tmReturnToBegin = 1000;
    m.m_nHitPoint = 10;
    const ai = new AISystem({
      spawnManager: makeSpawn([m]),
      zoneManager: makeZone(casts),
      playerManager: makePlayers(new Map()),
    });
    ai.tick(1000);
    assert.equal(m.m_bReturnToBegin, false, 'arrived');
    assert.equal(m.m_fSpeedFactor, 1.0, 'speed reset');
    // v19 `DoReturnToBegin(FALSE)` full-heals on arrival (`AIMonster.cpp:305`,
    // SetPointParam(DST_HP, GetMaxHitPoint()) with bTrans=FALSE -- silent, no
    // S->C monster-HP-sync packet). v19 accepts the client/server HP desync.
    assert.equal(m.m_nHitPoint, m.m_nMaxHitPoint, 'HP healed to max on return home (v19 silent heal)');
  });
});

describe('AISystem (retaliation)', () => {
  it('a mob with a target swings back at the player (no position-based gate)', () => {
    // Regression: pursue() previously dropped the target whenever the player
    // was within a 1000-unit "town safe zone" of the zone revival. Real spawns
    // sat inside that bubble (Mushpang field ~210 u from Flaris revival), so
    // every near-town mob acquired-then-instant-leashed and never swung back.
    // C++ AIMSG_DAMAGE retaliation has NO safety gate (the only such check, on
    // sight-scan, is commented out at AIMonster.cpp:429) -- the distance leash
    // alone anchors the mob. Vanilla town safety is the RA_SAFETY region attr
    // (AABB), not a revival-radius bubble; that gate is wired via the
    // `safeZone` dep (see the next test) and is unset here so the mob swings.
    const casts: Cast[] = [];
    const player = CPlayer.fromRow(makeRow({ id: 6, hp: 200, max_hp: 200 }), { write: () => true } as never);
    player.m_nZoneId = 1;
    player.m_vPos = { x: 1000, y: 0, z: 1000 };
    const m = makeMover(0x40000041, { x: 1002, y: 0, z: 1000 }); // within melee range
    m.m_fSpeedBase = 0.075;
    m.m_nAtkMin = 16; m.m_nAtkMax = 16; m.m_nHR = 40;
    m.m_idTarget = player.m_idPlayer; // already raged
    m.m_nextAttackTick = 0; // ready to swing
    const ai = new AISystem({
      spawnManager: makeSpawn([m]),
      zoneManager: makeZone(casts),
      playerManager: makePlayers(new Map([[player.m_idPlayer, player]])),
      // Deterministic rolls: int()=0 always passes the hit-rate check (m_nHR=40
      // would otherwise miss ~60% of the time on the default Math.random rng).
      rng: { int: () => 0, range: () => 16 } as never,
    });
    ai.tick(1000);
    assert.equal(m.m_idTarget, player.m_idPlayer, 'target retained');
    assert.equal(m.m_bReturnToBegin, false, 'monster does NOT leash home');
    assert.ok(player.m_nHp < 200, 'monster swung back (player took damage)');
  });

  it('drops aggro on a target standing inside a safe zone (v19 AIMonster.cpp:1621-1628)', () => {
    // v19 gate: if pTarget->IsRegionAttr(RA_SAFETY) && !RANK_GUARD, DoReturnToBegin.
    // The `safeZone` dep is the AABB check over the zone's `regions: type: safe`.
    const casts: Cast[] = [];
    const player = CPlayer.fromRow(makeRow({ id: 7, hp: 200, max_hp: 200 }), { write: () => true } as never);
    player.m_nZoneId = 1;
    player.m_vPos = { x: 6978, y: 100, z: 3329 }; // Flaris revival -- inside the safe region
    const m = makeMover(0x40000042, { x: 6979, y: 0, z: 3329 }); // within melee range
    m.m_fSpeedBase = 0.075;
    m.m_nAtkMin = 16; m.m_nAtkMax = 16; m.m_nHR = 40;
    m.m_idTarget = player.m_idPlayer;
    m.m_nextAttackTick = 0;
    const ai = new AISystem({
      spawnManager: makeSpawn([m]),
      zoneManager: makeZone(casts),
      playerManager: makePlayers(new Map([[player.m_idPlayer, player]])),
      // Mirror of compose.ts: Flaris safe region AABB (flaris.yml id 1).
      safeZone: (zoneId, pos) => zoneId === 1
        && pos.x >= 6800 && pos.x <= 7200 && pos.z >= 3100 && pos.z <= 3600,
    });
    ai.tick(1000);
    assert.equal(m.m_idTarget, 0xffffffff, 'target dropped (safe-zone gate fired)');
    assert.equal(m.m_bReturnToBegin, true, 'monster returns home instead of swinging into town');
    assert.equal(player.m_nHp, 200, 'player took no damage (mob released before swinging)');
  });
});

describe('AISystem (flee / low-HP retreat)', () => {
  /** Aggressive monster that flees at 30% HP. */
  function fleeingSrc(hp = 100): MoverSpawnSource {
    return {
      modelIndex: 20, name: 'Fleer', level: 1, hp,
      attackable: true, guard: false, belligerence: 6,
      fleeHpPct: 30, runawayDelay: RUNAWAY_DELAY_MS,
    };
  }

  it('drops target + flees AWAY from the player when HP crosses the flee threshold', () => {
    const casts: Cast[] = [];
    const player = CPlayer.fromRow(makeRow({ id: 80, hp: 200, max_hp: 200 }), { write: () => true } as never);
    player.m_nZoneId = 1;
    player.m_vPos = { x: 100, y: 0, z: 0 };
    const m = CMover.spawn(0x40000080, fleeingSrc(100), { x: 0, y: 0, z: 0 }, 1);
    m.m_fSpeedBase = 0.075;
    m.m_nAtkMin = 16; m.m_nAtkMax = 16; m.m_nHR = 40;
    m.m_idTarget = player.m_idPlayer; // already raged
    m.m_nextAttackTick = 0;
    m.m_nHitPoint = 20; // 20% of 100 -> <= 30 flee threshold
    const ai = new AISystem({
      spawnManager: makeSpawn([m]),
      zoneManager: makeZone(casts),
      playerManager: makePlayers(new Map([[player.m_idPlayer, player]])),
    });
    ai.tick(5000);
    assert.equal(m.m_bRunaway, true, 'monster entered runaway state');
    assert.equal(m.m_idTarget, 0xffffffff, 'target dropped');
    // Ran AWAY from the player: monster started at x=0, player at x=100 -> flee dir is -x.
    assert.ok(m.m_vPos.x < 0, `fled away from player (x=${m.m_vPos.x} should be < 0)`);
  });

  it('transitions to return-home after the runaway duration elapses', () => {
    const casts: Cast[] = [];
    const player = CPlayer.fromRow(makeRow({ id: 81, hp: 200, max_hp: 200 }), { write: () => true } as never);
    player.m_nZoneId = 1;
    player.m_vPos = { x: 100, y: 0, z: 0 };
    const m = CMover.spawn(0x40000081, fleeingSrc(100), { x: 0, y: 0, z: 0 }, 1);
    m.m_fSpeedBase = 0.075;
    m.m_idTarget = player.m_idPlayer;
    m.m_nHitPoint = 20; // below flee threshold
    const ai = new AISystem({
      spawnManager: makeSpawn([m]),
      zoneManager: makeZone(casts),
      playerManager: makePlayers(new Map([[player.m_idPlayer, player]])),
    });
    ai.tick(5000); // enter runaway (m_tmRunawayEnd = 5000 + RUNAWAY_DELAY_MS)
    assert.equal(m.m_bRunaway, true);
    ai.tick(5000 + RUNAWAY_DELAY_MS + 1); // runaway expired -> return home
    assert.equal(m.m_bRunaway, false, 'runaway cleared');
    assert.equal(m.m_bReturnToBegin, true, 'transitioned to return-home');
  });

  it('a monster with no fleeHpPct never flees, even at 1 HP', () => {
    const casts: Cast[] = [];
    const player = CPlayer.fromRow(makeRow({ id: 82, hp: 200, max_hp: 200 }), { write: () => true } as never);
    player.m_nZoneId = 1;
    player.m_vPos = { x: 2, y: 0, z: 0 }; // within melee range
    const m = makeMover(0x40000082, { x: 0, y: 0, z: 0 }); // monsterSrc -> no fleeHpPct
    m.m_fSpeedBase = 0.075;
    m.m_nAtkMin = 16; m.m_nAtkMax = 16; m.m_nHR = 40;
    m.m_idTarget = player.m_idPlayer;
    m.m_nextAttackTick = 0;
    m.m_nHitPoint = 1; // 1% HP -- but no flee threshold set
    const ai = new AISystem({
      spawnManager: makeSpawn([m]),
      zoneManager: makeZone(casts),
      playerManager: makePlayers(new Map([[player.m_idPlayer, player]])),
      rng: { int: () => 0, range: () => 16 } as never,
    });
    ai.tick(1000);
    assert.equal(m.m_bRunaway, false, 'no flee threshold -> never flees');
    // Still fights: swings at the player.
    assert.ok(casts.find((c) => subtypeOf(c.packet) === 0x0013), 'still swings at 1 HP');
  });

  it('a fleeing monster does not swing at the player while running', () => {
    const casts: Cast[] = [];
    const player = CPlayer.fromRow(makeRow({ id: 83, hp: 200, max_hp: 200 }), { write: () => true } as never);
    player.m_nZoneId = 1;
    player.m_vPos = { x: 100, y: 0, z: 0 };
    const m = CMover.spawn(0x40000083, fleeingSrc(100), { x: 0, y: 0, z: 0 }, 1);
    m.m_fSpeedBase = 0.075;
    m.m_nAtkMin = 16; m.m_nAtkMax = 16; m.m_nHR = 40;
    m.m_idTarget = player.m_idPlayer;
    m.m_nextAttackTick = 0;
    m.m_nHitPoint = 20; // below flee threshold
    const ai = new AISystem({
      spawnManager: makeSpawn([m]),
      zoneManager: makeZone(casts),
      playerManager: makePlayers(new Map([[player.m_idPlayer, player]])),
    });
    ai.tick(5000);
    assert.equal(m.m_bRunaway, true);
    assert.ok(!casts.find((c) => subtypeOf(c.packet) === 0x0013), 'no DAMAGE while fleeing');
    assert.ok(!casts.find((c) => subtypeOf(c.packet) === 0x00e0), 'no MELEE_ATTACK while fleeing');
  });
});

describe('AISystem (healer / self-heal)', () => {
  /** Aggressive monster that self-heals at 50% HP, 20 HP per tick. */
  function healerSrc(hp = 100): MoverSpawnSource {
    return {
      modelIndex: 20, name: 'Healer', level: 1, hp,
      attackable: true, guard: false, belligerence: 6,
      healHpPct: 50, healAmount: 20, healCadenceMs: 1000,
    };
  }

  it('self-heals when HP drops to the heal threshold, still in combat', () => {
    const casts: Cast[] = [];
    const player = CPlayer.fromRow(makeRow({ id: 90, hp: 200, max_hp: 200 }), { write: () => true } as never);
    player.m_nZoneId = 1;
    player.m_vPos = { x: 2, y: 0, z: 0 }; // within melee range
    const m = CMover.spawn(0x40000090, healerSrc(100), { x: 0, y: 0, z: 0 }, 1);
    m.m_fSpeedBase = 0.075;
    m.m_nAtkMin = 16; m.m_nAtkMax = 16; m.m_nHR = 40;
    m.m_idTarget = player.m_idPlayer;
    m.m_nextAttackTick = 0;
    m.m_nHitPoint = 40; // 40% of 100 -> <= 50% heal threshold
    const ai = new AISystem({
      spawnManager: makeSpawn([m]),
      zoneManager: makeZone(casts),
      playerManager: makePlayers(new Map([[player.m_idPlayer, player]])),
      rng: { int: () => 0, range: () => 16 } as never,
    });
    ai.tick(5000);
    assert.ok(m.m_nHitPoint > 40, `healed above 40 (got ${m.m_nHitPoint})`);
    assert.equal(m.m_idTarget, player.m_idPlayer, 'still targeting player while healing');
    assert.equal(m.m_bRunaway, false, 'does NOT flee (separate from flee state)');
    assert.ok(m.m_tmNextHealTick > 5000, 'heal cadence armed');
  });

  it('does not exceed max HP when self-healing', () => {
    const casts: Cast[] = [];
    const player = CPlayer.fromRow(makeRow({ id: 91, hp: 200, max_hp: 200 }), { write: () => true } as never);
    player.m_nZoneId = 1;
    player.m_vPos = { x: 2, y: 0, z: 0 };
    const m = CMover.spawn(0x40000091, healerSrc(100), { x: 0, y: 0, z: 0 }, 1);
    m.m_fSpeedBase = 0.075;
    m.m_nAtkMin = 16; m.m_nAtkMax = 16; m.m_nHR = 40;
    m.m_idTarget = player.m_idPlayer;
    m.m_nextAttackTick = 100_000; // suppress swing, only heal
    m.m_nHealHpPct = 96; // override: 95% <= 96% so heal fires
    m.m_nHitPoint = 95; // 5 HP below max (20 hp heal would overshoot)
    const ai = new AISystem({
      spawnManager: makeSpawn([m]),
      zoneManager: makeZone(casts),
      playerManager: makePlayers(new Map([[player.m_idPlayer, player]])),
    });
    ai.tick(5000);
    assert.equal(m.m_nHitPoint, m.m_nMaxHitPoint, 'healed to max, not beyond');
  });

  it('a monster with no healHpPct never self-heals, even at 1 HP', () => {
    const casts: Cast[] = [];
    const player = CPlayer.fromRow(makeRow({ id: 92, hp: 200, max_hp: 200 }), { write: () => true } as never);
    player.m_nZoneId = 1;
    player.m_vPos = { x: 2, y: 0, z: 0 };
    const m = makeMover(0x40000092, { x: 0, y: 0, z: 0 });
    m.m_fSpeedBase = 0.075;
    m.m_idTarget = player.m_idPlayer;
    m.m_nextAttackTick = 100_000;
    m.m_nHitPoint = 1;
    const ai = new AISystem({
      spawnManager: makeSpawn([m]),
      zoneManager: makeZone(casts),
      playerManager: makePlayers(new Map([[player.m_idPlayer, player]])),
    });
    ai.tick(5000);
    assert.equal(m.m_nHitPoint, 1, 'no self-heal without healHpPct');
  });

  it('heal cooldown is respected: only heals once per cadence', () => {
    const casts: Cast[] = [];
    const player = CPlayer.fromRow(makeRow({ id: 93, hp: 200, max_hp: 200 }), { write: () => true } as never);
    player.m_nZoneId = 1;
    player.m_vPos = { x: 20, y: 0, z: 0 }; // out of melee range -> no swing interference
    const m = CMover.spawn(0x40000093, healerSrc(100), { x: 0, y: 0, z: 0 }, 1);
    m.m_fSpeedBase = 0.075;
    m.m_nAtkMin = 16; m.m_nAtkMax = 16; m.m_nHR = 40;
    m.m_idTarget = player.m_idPlayer;
    m.m_nextAttackTick = 100_000;
    m.m_nHitPoint = 30; // 30% of 100 — still <= 50% threshold after first heal (50)
    const ai = new AISystem({
      spawnManager: makeSpawn([m]),
      zoneManager: makeZone(casts),
      playerManager: makePlayers(new Map([[player.m_idPlayer, player]])),
    });
    ai.tick(5000); // tick 1: heals 20 -> HP 50
    assert.equal(m.m_nHitPoint, 50, 'one heal applied');
    ai.tick(5001); // only 1 ms later — cooldown not yet elapsed
    assert.equal(m.m_nHitPoint, 50, 'second heal blocked by cooldown');
    ai.tick(6001); // 1001 ms later — cooldown elapsed -> heal again
    assert.equal(m.m_nHitPoint, 70, 'second heal applied after cooldown');
  });
});


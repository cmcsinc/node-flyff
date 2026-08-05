/**
 * PetSystem -- looter-pet summon/dismiss toggle, owner follow, ground-item scan,
 * arrival pickup, leash re-summon.
 */

import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { CPlayer, NULL_ID, OBJSTAF } from '@flyff/entities';
import type { CharacterRow } from '@flyff/database';
import { GroundItem } from '@flyff/inventory';
import { PetSystem, TID_CANNOT_CALL_PET_ON_FLYING } from '../../src/systems/pet.system';

const PET_LINK = 725; // MI_PET_DOG01
const ITEM_OBJID = 3;

function makeRow(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 42, account_id: 7, name: 'PetOwner', slot: 0, class: 1, gender: 0,
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

/** Minimal live-mover stand-in matching what PetSystem reads off a CMover. */
interface FakeMover {
  m_idMover: number;
  m_vPos: { x: number; y: number; z: number };
  m_nZoneId: number;
  m_fSpeedBase: number;
}

function makeDeps(player: CPlayer, piles: GroundItem[] = []) {
  const movers = new Map<number, FakeMover>();
  const killed: number[] = [];
  const broadcasts: Buffer[] = [];
  const notified: number[] = [];
  const picked: GroundItem[] = [];
  let nextMoverId = 900;
  const pileMap = new Map(piles.map((p) => [p.m_idObject, p]));

  const deps = {
    movers, killed, broadcasts, notified, picked, pileMap,
    /** Test knobs: flip these to exercise the two pet-only IsLoot filters. */
    lootable: true,
    fits: true,
    playerManager: {
      get: (id: number) => (id === player.m_idPlayer ? player : undefined),
      all: () => [player],
      sendTo: () => {},
    },
    zoneManager: {
      broadcastAround: (_pos: unknown, _zid: number, _r: number, pkt: Buffer) => { broadcasts.push(pkt); return 1; },
    },
    spawnManager: {
      spawnMonster: (moverId: number, pos: { x: number; y: number; z: number }, zoneId: number) => {
        if (moverId !== PET_LINK) return undefined; // unknown mover id
        const m: FakeMover = { m_idMover: nextMoverId++, m_vPos: { ...pos }, m_nZoneId: zoneId, m_fSpeedBase: 0.1 };
        movers.set(m.m_idMover, m);
        return m;
      },
      get: (id: number) => movers.get(id),
      kill: (id: number) => { killed.push(id); movers.delete(id); return true; },
    },
    itemManager: {
      all: () => pileMap.values(),
      get: (id: number) => pileMap.get(id),
    },
    lootService: {
      isLoot: () => deps.lootable,
      pickup: (_p: CPlayer, item: GroundItem) => { picked.push(item); pileMap.delete(item.m_idObject); },
    },
    inventoryService: { canFit: () => deps.fits },
    notify: (_p: CPlayer, tid: number) => { notified.push(tid); },
    now: () => 0,
  };
  return deps;
}

function makePile(id: number, pos: { x: number; y: number; z: number }, zoneId = 1): GroundItem {
  return GroundItem.spawn(id, { itemId: 7, count: 1, ownerId: NULL_ID, pos, zoneId }, 0);
}

describe('PetSystem.toggle (summon/dismiss)', () => {
  let player: CPlayer;
  beforeEach(() => { player = CPlayer.fromRow(makeRow(), makeSocket()); });

  it('summons a mover of the item link_kind and records it on m_oiEatPet', () => {
    const deps = makeDeps(player);
    const sys = new PetSystem(deps as never);

    assert.equal(sys.toggle(player, ITEM_OBJID, PET_LINK), true);
    assert.notEqual(player.m_oiEatPet, NULL_ID, 'pet objid recorded on the owner');
    assert.equal(deps.movers.size, 1, 'one pet mover alive');
    const pet = [...deps.movers.values()][0]!;
    assert.deepEqual(pet.m_vPos, player.m_vPos, 'spawned at the owner');
  });

  it('a second toggle dismisses: mover killed, m_oiEatPet cleared', () => {
    const deps = makeDeps(player);
    const sys = new PetSystem(deps as never);
    sys.toggle(player, ITEM_OBJID, PET_LINK);
    const moverId = player.m_oiEatPet;

    assert.equal(sys.toggle(player, ITEM_OBJID, PET_LINK), true);
    assert.equal(player.m_oiEatPet, NULL_ID, 'cleared');
    assert.deepEqual(deps.killed, [moverId], 'pet mover killed');
    assert.equal(deps.movers.size, 0);
  });

  it('refuses to summon while flying, with TID_GAME_CANNOT_CALL_PET_ON_FLYING', () => {
    const deps = makeDeps(player);
    const sys = new PetSystem(deps as never);
    player.m_dwStateFlag |= OBJSTAF.FLY;
    assert.equal(player.isFly(), true, 'precondition: player is airborne');

    assert.equal(sys.toggle(player, ITEM_OBJID, PET_LINK), false);
    assert.deepEqual(deps.notified, [TID_CANNOT_CALL_PET_ON_FLYING]);
    assert.equal(player.m_oiEatPet, NULL_ID, 'no pet on a refused summon');
  });

  it('rejects an unknown link_kind without touching owner state', () => {
    const deps = makeDeps(player);
    const sys = new PetSystem(deps as never);
    assert.equal(sys.toggle(player, ITEM_OBJID, 999999), false);
    assert.equal(player.m_oiEatPet, NULL_ID);
  });
});

describe('PetSystem.tick (follow)', () => {
  it('walks toward an owner further than the follow trigger', () => {
    const player = CPlayer.fromRow(makeRow(), makeSocket());
    const deps = makeDeps(player);
    const sys = new PetSystem(deps as never);
    sys.toggle(player, ITEM_OBJID, PET_LINK);
    const pet = deps.movers.get(player.m_oiEatPet)!;

    player.m_vPos = { x: 20, y: 0, z: 0 };
    const before = pet.m_vPos.x;
    sys.tick(100);
    sys.tick(200);
    assert.ok(pet.m_vPos.x > before, 'pet stepped toward the owner');
    assert.ok(deps.broadcasts.length >= 1, 'one destination packet on the state change');
  });

  it('stands still when already within the follow trigger', () => {
    const player = CPlayer.fromRow(makeRow(), makeSocket());
    const deps = makeDeps(player);
    const sys = new PetSystem(deps as never);
    sys.toggle(player, ITEM_OBJID, PET_LINK);
    const pet = deps.movers.get(player.m_oiEatPet)!;
    const before = { ...pet.m_vPos };

    sys.tick(100);
    assert.deepEqual(pet.m_vPos, before, 'no movement inside the trigger radius');
  });
});

describe('PetSystem.tick (loot)', () => {
  it('scans, walks to a nearby pile, and loots it through the owner', () => {
    const player = CPlayer.fromRow(makeRow(), makeSocket());
    const pile = makePile(500, { x: 8, y: 0, z: 0 });
    const deps = makeDeps(player, [pile]);
    const sys = new PetSystem(deps as never);
    sys.toggle(player, ITEM_OBJID, PET_LINK);
    const pet = deps.movers.get(player.m_oiEatPet)!;
    // Keep the owner on top of the pet so the 32-unit leash never trips.
    player.m_vPos = { x: 8, y: 0, z: 0 };

    // First tick past the scan interval acquires the pile; later ticks walk.
    for (let t = 1100; t <= 6000 && deps.picked.length === 0; t += 100) sys.tick(t);

    assert.equal(deps.picked.length, 1, 'pile looted');
    assert.equal(deps.picked[0]!.m_idObject, pile.m_idObject);
    assert.ok(Math.abs(pet.m_vPos.x - pile.m_vPos.x) <= 5, 'looted from within the arrival radius');
  });

  it('ignores a pile the owner may not loot (IsLoot false)', () => {
    const player = CPlayer.fromRow(makeRow(), makeSocket());
    const deps = makeDeps(player, [makePile(501, { x: 3, y: 0, z: 0 })]);
    deps.lootable = false;
    const sys = new PetSystem(deps as never);
    sys.toggle(player, ITEM_OBJID, PET_LINK);

    for (let t = 1100; t <= 4000; t += 100) sys.tick(t);
    assert.equal(deps.picked.length, 0, 'owner-locked pile left alone');
  });

  it('ignores a pile that would not fit -- the pet-only bag-full filter', () => {
    const player = CPlayer.fromRow(makeRow(), makeSocket());
    const deps = makeDeps(player, [makePile(502, { x: 3, y: 0, z: 0 })]);
    deps.fits = false;
    const sys = new PetSystem(deps as never);
    sys.toggle(player, ITEM_OBJID, PET_LINK);

    for (let t = 1100; t <= 4000; t += 100) sys.tick(t);
    assert.equal(deps.picked.length, 0, 'bag-full pile left on the ground');
  });

  it('ignores a pile outside the 15-unit scan radius', () => {
    const player = CPlayer.fromRow(makeRow(), makeSocket());
    const deps = makeDeps(player, [makePile(503, { x: 25, y: 0, z: 0 })]);
    const sys = new PetSystem(deps as never);
    sys.toggle(player, ITEM_OBJID, PET_LINK);

    for (let t = 1100; t <= 4000; t += 100) sys.tick(t);
    assert.equal(deps.picked.length, 0, 'far pile not acquired');
  });

  it('picks the nearest of several candidate piles', () => {
    const player = CPlayer.fromRow(makeRow(), makeSocket());
    const far = makePile(504, { x: 12, y: 0, z: 0 });
    const near = makePile(505, { x: 4, y: 0, z: 0 });
    const deps = makeDeps(player, [far, near]);
    const sys = new PetSystem(deps as never);
    sys.toggle(player, ITEM_OBJID, PET_LINK);

    for (let t = 1100; t <= 6000 && deps.picked.length === 0; t += 100) sys.tick(t);
    assert.equal(deps.picked[0]!.m_idObject, near.m_idObject, 'nearest pile first');
  });
});

describe('PetSystem.tick (owner state)', () => {
  it('dismisses the pet when the owner dies', () => {
    const player = CPlayer.fromRow(makeRow(), makeSocket());
    const deps = makeDeps(player);
    const sys = new PetSystem(deps as never);
    sys.toggle(player, ITEM_OBJID, PET_LINK);
    const moverId = player.m_oiEatPet;

    player.m_bDead = true;
    sys.tick(100);

    assert.equal(player.m_oiEatPet, NULL_ID, 'pet gone with its owner');
    assert.deepEqual(deps.killed, [moverId]);
  });

  it('re-summons at the owner when the pet drifts past the 32-unit leash', () => {
    const player = CPlayer.fromRow(makeRow(), makeSocket());
    const deps = makeDeps(player);
    const sys = new PetSystem(deps as never);
    sys.toggle(player, ITEM_OBJID, PET_LINK);
    const original = player.m_oiEatPet;

    // Teleport the owner far away -- the old pet is now out of leash range.
    player.m_vPos = { x: 500, y: 0, z: 500 };
    sys.tick(100);

    assert.deepEqual(deps.killed, [original], 'stale pet removed');
    assert.notEqual(player.m_oiEatPet, NULL_ID, 'a fresh pet exists');
    assert.notEqual(player.m_oiEatPet, original, 'with a new objid');
    const pet = deps.movers.get(player.m_oiEatPet)!;
    assert.deepEqual(pet.m_vPos, player.m_vPos, 're-summoned at the owner');
  });

  it('stop() dismisses every live pet', () => {
    const player = CPlayer.fromRow(makeRow(), makeSocket());
    const deps = makeDeps(player);
    const sys = new PetSystem(deps as never);
    sys.toggle(player, ITEM_OBJID, PET_LINK);

    sys.stop();
    assert.equal(player.m_oiEatPet, NULL_ID);
    assert.equal(deps.movers.size, 0);
  });
});

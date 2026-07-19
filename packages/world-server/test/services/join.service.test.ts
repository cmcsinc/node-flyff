import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { JoinService } from '../../src/services/join.service.js';
import { PlayerManager } from '../../src/managers/player.manager.js';
import { ZoneManager } from '../../src/managers/zone.manager.js';
import type { CharacterRepository, CharacterRow } from '@flyff/database';

function makeRow(over: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 42, account_id: 7, name: 'Hero', slot: 0, class: 1, gender: 0,
    hair_style: 0, hair_color: 0, face_style: 0, skin_color: 0, level: 1,
    exp: 0n, hp: 100, mp: 50, max_hp: 100, max_mp: 50,
    strength: 15, stamina: 15, dexterity: 15, intelligence: 15,
    x: 10, y: 0, z: 20, world_id: 'W1', zone_id: 1,
    created_at: new Date(), updated_at: new Date(),
    ...over,
  };
}

function sock() {
  const sent: Buffer[] = [];
  return { write: (b: Buffer) => { sent.push(b); return true; }, _sent: sent };
}

/** Fake HandoffSource — yield a fixed handoff for its charId, single-use. */
function fakeHandoff(charId: number, worldId = 'W1') {
  let stored: { charId: number; worldId: string } | null = { charId, worldId };
  return {
    consumeByCharId: (id: number) => {
      if (id !== charId || !stored) return null;
      stored = null;
      return { charId: id, worldId };
    },
  };
}

function fakeCharRepo(row: CharacterRow | null): Pick<CharacterRepository, 'findById'> {
  return { findById: async () => row };
}

describe('JoinService', () => {
  let players: PlayerManager;
  let zones: ZoneManager;

  beforeEach(() => {
    players = new PlayerManager();
    zones = new ZoneManager();
  });

  it('spawns a player on a valid handoff + matching character', async () => {
    const handoff = fakeHandoff(42);
    const svc = new JoinService({
      charRepo: fakeCharRepo(makeRow()),
      playerManager: players,
      zoneManager: zones,
      handoffSource: handoff,
    });
    const outcome = await svc.join(sock() as never, 42);
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.player.m_idPlayer, 42);
      assert.equal(players.get(42), outcome.player);
    }
  });

  it('rejects an unknown / already-consumed handoff', async () => {
    const handoff = fakeHandoff(42);
    const svc = new JoinService({
      charRepo: fakeCharRepo(makeRow()),
      playerManager: players,
      zoneManager: zones,
      handoffSource: handoff,
    });
    handoff.consumeByCharId(42); // burn it
    const outcome = await svc.join(sock() as never, 42);
    assert.equal(outcome.ok, false);
    assert.equal(players.size, 0);
  });

  it('rejects when the character is not in the DB', async () => {
    const svc = new JoinService({
      charRepo: fakeCharRepo(null),
      playerManager: players,
      zoneManager: zones,
      handoffSource: fakeHandoff(42),
    });
    const outcome = await svc.join(sock() as never, 42);
    assert.equal(outcome.ok, false);
    assert.equal(players.size, 0);
  });

  it('rejects when the DB world ≠ handoff world', async () => {
    const svc = new JoinService({
      charRepo: fakeCharRepo(makeRow({ world_id: 'OTHER' })),
      playerManager: players,
      zoneManager: zones,
      handoffSource: fakeHandoff(42, 'W1'),
    });
    const outcome = await svc.join(sock() as never, 42);
    assert.equal(outcome.ok, false);
    assert.equal(players.size, 0);
  });

  it('leave() removes the player from both managers', async () => {
    const svc = new JoinService({
      charRepo: fakeCharRepo(makeRow()),
      playerManager: players,
      zoneManager: zones,
      handoffSource: fakeHandoff(42),
    });
    const outcome = await svc.join(sock() as never, 42);
    if (!outcome.ok) throw new Error('expected join ok');
    svc.leave(outcome.player);
    assert.equal(players.get(42), undefined);
    // zone broadcast reaches nobody now
    assert.equal(zones.broadcastZone(1, Buffer.alloc(1)), 0);
  });
});

import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { JoinService } from '../../src/services/join.service.js';
import { PlayerManager } from '../../src/managers/player.manager.js';
import { ZoneManager } from '../../src/managers/zone.manager.js';
import type { CharacterRepository, CharacterUpdateData, CharacterRow, BankRepository } from '@flyff/database';

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

/** Fake HandoffSource -- yield a fixed handoff for its charId, single-use. */
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

/**
 * Recording char repo for disconnect tests -- captures the last `update`
 * payload so the test can assert exactly which fields were checkpointed.
 */
function recordingCharRepo(row: CharacterRow): {
  repo: Pick<CharacterRepository, 'findById' | 'update'>;
  lastUpdate: { id: number; data: CharacterUpdateData } | null;
  updateCalls: number;
} {
  const state: { lastUpdate: { id: number; data: CharacterUpdateData } | null; updateCalls: number } = {
    lastUpdate: null,
    updateCalls: 0,
  };
  return {
    repo: {
      findById: async () => row,
      update: async (id: number, data: CharacterUpdateData) => {
        state.lastUpdate = { id, data };
        state.updateCalls++;
      },
    },
    get lastUpdate() { return state.lastUpdate; },
    get updateCalls() { return state.updateCalls; },
  };
}

/** Recording bank repo -- captures setGold calls. */
function recordingBankRepo(gold = 0): {
  repo: Pick<BankRepository, 'findByAccountId' | 'getGold' | 'setGold' | 'getBankPass'>;
  setGoldCalls: Array<{ accountId: number; amount: number }>;
} {
  const setGoldCalls: Array<{ accountId: number; amount: number }> = [];
  return {
    repo: {
      findByAccountId: async () => [],
      getGold: async () => gold,
      setGold: async (accountId: number, amount: number) => {
        setGoldCalls.push({ accountId, amount });
      },
      getBankPass: async () => '0000',
    },
    setGoldCalls,
  };
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

  it('rejects when the DB world != handoff world', async () => {
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

  it('disconnectByCharId is a no-op when charId is undefined or player is missing', async () => {
    const rec = recordingCharRepo(makeRow());
    const svc = new JoinService({
      charRepo: rec.repo,
      playerManager: players,
      zoneManager: zones,
      handoffSource: fakeHandoff(42),
    });
    await svc.disconnectByCharId(undefined);
    await svc.disconnectByCharId(999); // never joined
    assert.equal(rec.updateCalls, 0);
    assert.equal(players.size, 0);
  });

  it('disconnectByCharId checkpoints live position/vitals/stats + bank gold, then leaves', async () => {
    const rec = recordingCharRepo(makeRow());
    const bank = recordingBankRepo(0);
    const svc = new JoinService({
      charRepo: rec.repo,
      bankRepo: bank.repo,
      playerManager: players,
      zoneManager: zones,
      handoffSource: fakeHandoff(42),
    });
    const outcome = await svc.join(sock() as never, 42);
    if (!outcome.ok) throw new Error('expected join ok');
    const p = outcome.player;
    // Simulate a session of play: walked east, turned, took damage, banked gold.
    p.m_vPos = { x: 77.5, y: 1, z: -30 };
    p.m_fAngle = 2.5;
    p.m_nHp = 42;
    p.m_nMp = 7;
    p.m_nMaxHp = 120;
    p.m_nStr = 20;
    p.m_BankGold[0] = 5000;

    await svc.disconnectByCharId(42);

    assert.equal(rec.updateCalls, 1);
    const data = rec.lastUpdate!.data;
    assert.deepEqual({ x: data.x, y: data.y, z: data.z }, { x: 77.5, y: 1, z: -30 });
    assert.equal(data.angle, 2.5);
    assert.equal(data.hp, 42);
    assert.equal(data.mp, 7);
    assert.equal(data.max_hp, 120);
    assert.equal(data.strength, 20);
    assert.equal(data.world_id, 'W1');
    assert.equal(data.zone_id, 1);
    assert.deepEqual(bank.setGoldCalls, [{ accountId: 7, amount: 5000 }]);
    // Player is dropped from the live set -- no ghost.
    assert.equal(players.get(42), undefined);
    assert.equal(zones.broadcastZone(1, Buffer.alloc(1)), 0);
  });

  it('disconnectByCharId still removes the player if the DB write throws', async () => {
    const bank = recordingBankRepo(0);
    const svc = new JoinService({
      charRepo: {
        findById: async () => makeRow(),
        update: async () => { throw new Error('db down'); },
      },
      bankRepo: bank.repo,
      playerManager: players,
      zoneManager: zones,
      handoffSource: fakeHandoff(42),
    });
    const outcome = await svc.join(sock() as never, 42);
    if (!outcome.ok) throw new Error('expected join ok');

    await svc.disconnectByCharId(42);
    // Save failed but the player is still removed -- no ghost lingers.
    assert.equal(players.get(42), undefined);
    assert.equal(bank.setGoldCalls.length, 0, 'setGold skipped after update threw');
  });

  it('flushAll checkpoints every live player (fire-and-forget) without removing them', async () => {
    const rec = recordingCharRepo(makeRow());
    const svc = new JoinService({
      charRepo: rec.repo,
      playerManager: players,
      zoneManager: zones,
      handoffSource: fakeHandoff(42),
    });
    const outcome = await svc.join(sock() as never, 42);
    if (!outcome.ok) throw new Error('expected join ok');
    outcome.player.m_nHp = 55;

    svc.flushAll();
    // flushAll is fire-and-forget; let the microtask drain.
    await new Promise((r) => setImmediate(r));

    assert.equal(rec.updateCalls, 1);
    assert.equal(rec.lastUpdate!.data.hp, 55);
    // checkpoint does NOT remove the player (unlike disconnect).
    assert.equal(players.get(42), outcome.player);
  });

  it('hydrates m_fAngle from the character row on JOIN', async () => {
    const svc = new JoinService({
      charRepo: fakeCharRepo(makeRow({ angle: 1.25 })),
      playerManager: players,
      zoneManager: zones,
      handoffSource: fakeHandoff(42),
    });
    const outcome = await svc.join(sock() as never, 42);
    if (!outcome.ok) throw new Error('expected join ok');
    assert.equal(outcome.player.m_fAngle, 1.25);
  });

  it('defaults m_fAngle to 0 when the row omits angle', async () => {
    const svc = new JoinService({
      charRepo: fakeCharRepo(makeRow()), // angle not set
      playerManager: players,
      zoneManager: zones,
      handoffSource: fakeHandoff(42),
    });
    const outcome = await svc.join(sock() as never, 42);
    if (!outcome.ok) throw new Error('expected join ok');
    assert.equal(outcome.player.m_fAngle, 0);
  });
});

/**
 * AdminCommandService.kick -- notice-then-close ordering.
 *
 * The whole point of this path: the v19 client ignores a bare socket close on
 * the world connection (see kick.serializer.ts), so the notice MUST land first
 * and the close MUST be deferred past the write.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import { CPlayer, AUTH } from '@flyff/entities';
import type { CharacterRow } from '@flyff/database';
import { AdminCommandService } from '../../src/services/adminCommand.service';
import { SNAPSHOTTYPE_SEALCHARGET_REQ } from '../../src/net/snapshot/kick.serializer';

function makeRow(id: number, name: string): CharacterRow {
  return {
    id, account_id: 1, name, slot: 0, class: 1, gender: 0,
    hair_style: 0, hair_color: 0, face_style: 0, skin_color: 0, level: 1,
    exp: 0n, hp: 1, mp: 1, max_hp: 1, max_mp: 1, strength: 1, stamina: 1,
    dexterity: 1, intelligence: 1, x: 0, y: 0, z: 0, world_id: 'W', zone_id: 1,
    created_at: new Date(), updated_at: new Date(),
  };
}

/** Records writes and destroy in one ordered log so sequencing is assertable. */
function harness(opts: { writeThrows?: boolean } = {}) {
  const log: string[] = [];
  const sent: Buffer[] = [];
  const socket = {
    write: (b: Buffer) => {
      if (opts.writeThrows) throw new Error('EPIPE');
      log.push('write');
      sent.push(b);
      return true;
    },
    destroy: () => { log.push('destroy'); },
  };
  const player = CPlayer.fromRow(makeRow(7, 'Kicked'), socket, AUTH.GENERAL);
  const playerManager = {
    get: (id: number) => (id === 7 ? player : undefined),
    all: () => [player],
    sendTo: (p: CPlayer, buf: Buffer) => { p.socket.write(buf); },
  } as unknown as import('@flyff/world-core').PlayerManager;
  const svc = new AdminCommandService({
    playerManager,
    setPosSer: {} as never,
    zones: { byNumericId: new Map() },
    refreshVisibility: () => {},
    kickCloseDelayMs: 500,
  });
  return { svc, log, sent, player };
}

/**
 * Multi-player drain harness. `saveAndLeave` appends to the same log as the
 * writes/destroys so notice-before-save-before-close is directly assertable.
 */
function drainHarness(opts: { count?: number; failOn?: number[]; noSave?: boolean } = {}) {
  const count = opts.count ?? 3;
  const failOn = new Set(opts.failOn ?? []);
  const log: string[] = [];
  const players = Array.from({ length: count }, (_, i) => {
    const id = i + 1;
    const socket = {
      write: () => { log.push(`write:${id}`); return true; },
      destroy: () => { log.push(`destroy:${id}`); },
    };
    return CPlayer.fromRow(makeRow(id, `P${id}`), socket, AUTH.GENERAL);
  });
  const playerManager = {
    get: (id: number) => players.find((p) => p.m_idPlayer === id),
    all: () => [...players],
    sendTo: (p: CPlayer, buf: Buffer) => { p.socket.write(buf); },
  } as unknown as import('@flyff/world-core').PlayerManager;
  const deps = {
    playerManager,
    setPosSer: {} as never,
    zones: { byNumericId: new Map() },
    refreshVisibility: () => {},
    kickCloseDelayMs: 500,
    ...(opts.noSave ? {} : {
      saveAndLeave: async (charId: number) => {
        if (failOn.has(charId)) throw new Error(`flush failed for ${charId}`);
        log.push(`save:${charId}`);
      },
    }),
  };
  return { svc: new AdminCommandService(deps), log, players };
}

describe('AdminCommandService.kick', () => {
  beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }); });
  afterEach(() => { mock.timers.reset(); });

  it('writes the notice before closing, and defers the close', () => {
    const h = harness();
    h.svc.kick(7);

    assert.deepEqual(h.log, ['write'], 'socket must not be destroyed in the same tick');
    mock.timers.tick(499);
    assert.deepEqual(h.log, ['write'], 'close fired before the grace window elapsed');
    mock.timers.tick(1);
    assert.deepEqual(h.log, ['write', 'destroy']);
  });

  it('the written frame is the SEALCHARGET_REQ notice', () => {
    const h = harness();
    h.svc.kick(7);
    // playerManager.sendTo frames in prod; this stub writes the raw payload, so
    // the sub-type sits at the serializer's own offset.
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0]!.readUInt16LE(14), SNAPSHOTTYPE_SEALCHARGET_REQ);
  });

  it('still closes when the notice write throws (dead socket)', () => {
    const h = harness({ writeThrows: true });
    h.svc.kick(7);
    mock.timers.tick(500);
    assert.deepEqual(h.log, ['destroy'], 'a failed notice must not block the disconnect');
  });

  it('is a no-op for an offline character', () => {
    const h = harness();
    h.svc.kick(999);
    mock.timers.tick(1000);
    assert.deepEqual(h.log, []);
  });
});

describe('AdminCommandService.kickAll', () => {
  beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }); });
  afterEach(() => { mock.timers.reset(); });

  it('notices everyone, then saves everyone, then closes everyone', async () => {
    const h = drainHarness({ count: 3 });
    const result = await h.svc.kickAll('restart');

    assert.deepEqual(result, { total: 3, saved: 3, failed: [] });
    // All notices precede all saves: a stalled DB must not stagger the boxes.
    assert.deepEqual(h.log, [
      'write:1', 'write:2', 'write:3',
      'save:1', 'save:2', 'save:3',
    ], 'no destroy before the grace window');

    mock.timers.tick(500);
    assert.deepEqual(h.log.slice(-3), ['destroy:1', 'destroy:2', 'destroy:3']);
  });

  it('a failed flush is reported but still disconnects that player', async () => {
    const h = drainHarness({ count: 3, failOn: [2] });
    const result = await h.svc.kickAll();

    assert.deepEqual(result, { total: 3, saved: 2, failed: [2] });
    assert.ok(!h.log.includes('save:2'), 'player 2 never flushed');
    mock.timers.tick(500);
    assert.ok(h.log.includes('destroy:2'), 'player 2 disconnected anyway');
    assert.ok(h.log.includes('save:3'), 'one failure must not abort the drain');
  });

  it('closes sockets even though saveAndLeave removed the players', async () => {
    // Real `disconnectByCharId` drops the player from PlayerManager, so the
    // close loop must use sockets captured up front, not a re-read of all().
    const log: string[] = [];
    const players = [1, 2].map((id) =>
      CPlayer.fromRow(makeRow(id, `P${id}`), {
        write: () => true,
        destroy: () => { log.push(`destroy:${id}`); },
      }, AUTH.GENERAL),
    );
    const live = new Map(players.map((p) => [p.m_idPlayer, p]));
    const svc = new AdminCommandService({
      playerManager: {
        get: (id: number) => live.get(id),
        all: () => [...live.values()],
        sendTo: (p: CPlayer, buf: Buffer) => { p.socket.write(buf); },
      } as unknown as import('@flyff/world-core').PlayerManager,
      setPosSer: {} as never,
      zones: { byNumericId: new Map() },
      refreshVisibility: () => {},
      kickCloseDelayMs: 500,
      saveAndLeave: async (charId: number) => { live.delete(charId); },
    });

    await svc.kickAll();
    assert.equal(live.size, 0, 'all players de-registered');
    mock.timers.tick(500);
    assert.deepEqual(log, ['destroy:1', 'destroy:2']);
  });

  it('without saveAndLeave it still disconnects, reporting zero saved', async () => {
    const h = drainHarness({ count: 2, noSave: true });
    const result = await h.svc.kickAll();
    assert.deepEqual(result, { total: 2, saved: 0, failed: [] });
    mock.timers.tick(500);
    assert.deepEqual(h.log, ['write:1', 'write:2', 'destroy:1', 'destroy:2']);
  });

  it('is a no-op on an empty world', async () => {
    const h = drainHarness({ count: 0 });
    const result = await h.svc.kickAll();
    assert.deepEqual(result, { total: 0, saved: 0, failed: [] });
    mock.timers.tick(500);
    assert.deepEqual(h.log, []);
  });
});

/**
 * Tests for {@link NpcSpeechService}.
 *
 * Core logic is tested deterministically via injected `now`/`random` (no
 * `mock.timers` needed -- `bootstrap()` + `tick()` are called directly, the real
 * `setInterval` from `start()` is only exercised by the trivial `stop()` check).
 *
 * @module test/services/npcSpeech.service
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { NpcSpeechService } from '../../src/services/npcSpeech.service';
import type { CMover } from '@flyff/entities';
import type { SpawnManager } from '@flyff/world-core';
import type { ZoneManager } from '@flyff/world-core';
import type { DialogIndex } from '@flyff/resources';

/** Minimal mover stub -- only the fields NpcSpeechService reads. */
function mover(id: number, characterKey: string | undefined, key?: string): CMover {
  return {
    m_idMover: id,
    m_szKey: key ?? '',
    m_vPos: { x: 10, y: 0, z: 20 },
    m_nZoneId: 1,
    outfit: characterKey ? { characterKey } : undefined,
  } as unknown as CMover;
}

/** Build a mock SpawnManager that yields `movers`. */
function mockSpawnManager(movers: CMover[]): SpawnManager {
  return {
    size: movers.length,
    all: function* () { yield* movers; },
    // tick() liveness-checks each due entry against the manager, so the fake
    // must resolve objid -> mover the same way the real one does.
    get: (id: number) => movers.find((m) => m.m_idMover === id),
  } as unknown as SpawnManager;
}

/** Build a mock ZoneManager recording every broadcast. */
function mockZoneManager(): { zone: ZoneManager; calls: Array<{ objid: number; text: string; zoneId: number }> } {
  const calls: Array<{ objid: number; text: string; zoneId: number }> = [];
  const zone = {
    broadcastAround(pos: unknown, zoneId: number, _r: number, packet: Buffer): number {
      // First DWORD of the ChatSerializer payload is PACKETTYPE.SNAPSHOT; the
      // mover objid + text are encoded further in. Rather than decode wire
      // bytes here, the per-case assertions drive `text` through the serializer
      // indirectly -- we only assert reach count + call count + zoneId.
      calls.push({ objid: -1, text: '', zoneId });
      return 1;
    },
  } as unknown as ZoneManager;
  return { zone, calls };
}

/** Build a DialogIndex mapping `characterKey` -> prefix -> state-0 speak strings. */
function mockDialogs(spec: Array<{ key: string; prefix: string; speak?: string[]; say?: string[] }>): DialogIndex {
  const strings: string[] = [];
  const npcToPrefix = new Map<string, string>();
  const byPrefix = new Map();
  let nextStr = 100;
  for (const s of spec) {
    npcToPrefix.set(s.key, s.prefix);
    const speakIds: number[] = [];
    for (const t of s.speak ?? []) { strings[nextStr] = t; speakIds.push(nextStr); nextStr++; }
    const sayIds: number[] = [];
    for (const t of s.say ?? []) { strings[nextStr] = t; sayIds.push(nextStr); nextStr++; }
    byPrefix.set(s.prefix, { prefix: s.prefix, states: { '0': { ...(speakIds.length ? { speak: speakIds } : {}), ...(sayIds.length ? { say: sayIds } : {}) } } });
  }
  return { strings, npcToPrefix, byPrefix } as unknown as DialogIndex;
}

describe('NpcSpeechService', () => {
  it('schedules NPCs whose state 0 has speak lines; skips the rest', () => {
    const movers = [
      // Real-world path: spawned NPC carries its MI_* name on m_szKey.
      mover(1, undefined, 'MI_MAFL_BOBOKU'),  // speak greeting -> scheduled
      mover(2, 'MaFl_SayOnly'),     // only `say` -> skipped (not a bubble)
      mover(3, undefined),          // no characterKey (monster) -> skipped
      mover(4, 'MaFl_Unknown'),     // prefix unresolved -> skipped
      mover(5, 'MaFl_NoState0'),    // state 0 has no speak -> skipped
    ];
    const spawn = mockSpawnManager(movers);
    let fired = 0;
    const zone = {
      broadcastAround: () => { fired++; return 1; },
    } as unknown as ZoneManager;
    const dialogs = mockDialogs([
      { key: 'MaFl_Boboku', prefix: 'mafl_boboku', speak: ['Welcome to Flaris!'] },
      { key: 'MaFl_SayOnly', prefix: 'mafl_sayonly', say: ['private line'] },
      { key: 'MaFl_NoState0', prefix: 'mafl_nostate0' },
      // MaFl_Unknown deliberately has no dialog entry
    ]);

    const svc = new NpcSpeechService({ spawnManager: spawn, zoneManager: zone, dialogs, now: () => 0, random: () => 0.5 });
    // firstFireAt at t=0, random=0.5 -> 60000 + 15000 = 75000. Re-arm -> 15 + 5 = 20 s.
    const setNow = (t: number) => { (svc as unknown as { now: () => number }).now = () => t; };

    svc.bootstrap();
    svc.tick();
    assert.equal(fired, 0, 'no fire at t=0 (before firstFireAt)');

    setNow(75_000); svc.tick();
    assert.equal(fired, 1, 'fired once at firstFireAt');

    setNow(90_000); svc.tick();
    assert.equal(fired, 1, 'no fire before 20 s re-arm');

    setNow(95_000); svc.tick();
    assert.equal(fired, 2, 'fired again after re-arm');
  });

  it('broadcasts the NPC objid + greeting text via ChatSerializer', () => {
    const m = mover(42, 'MaFl_Hent');
    const spawn = mockSpawnManager([m]);
    let received: { zoneId: number; packet: Buffer } | null = null;
    const zone = {
      broadcastAround(_pos: unknown, zoneId: number, _r: number, packet: Buffer): number {
        received = { zoneId, packet };
        return 1;
      },
    } as unknown as ZoneManager;
    const dialogs = mockDialogs([{ key: 'MaFl_Hent', prefix: 'mafl_hent', speak: ['Acrobat greeting'] }]);
    const svc = new NpcSpeechService({ spawnManager: spawn, zoneManager: zone, dialogs, now: () => 0, random: () => 0 });

    svc.bootstrap();
    (svc as unknown as { now: () => number }).now = () => 90_000; // past 60-90 s first fire (random 0 -> 60 s)
    svc.tick();

    assert.ok(received, 'broadcast occurred');
    assert.equal(received!.zoneId, 1);
    // ChatSerializer payload contains the greeting text bytes.
    assert.ok(received!.packet.includes(Buffer.from('Acrobat greeting', 'utf8')), 'packet carries the greeting text');
  });

  it('cycles through multiple speak lines in state 0', () => {
    const m = mover(7, 'MaFl_Multi');
    const spawn = mockSpawnManager([m]);
    const texts: string[] = [];
    const zone = { broadcastAround: (_p: unknown, _z: number, _r: number, packet: Buffer): number => { texts.push(packet.toString('utf8')); return 1; } } as unknown as ZoneManager;
    const dialogs = mockDialogs([{ key: 'MaFl_Multi', prefix: 'mafl_multi', speak: ['first', 'second'] }]);
    const svc = new NpcSpeechService({ spawnManager: spawn, zoneManager: zone, dialogs, now: () => 0, random: () => 0 });

    svc.bootstrap();
    const fireAt = (t: number) => { (svc as unknown as { now: () => number }).now = () => t; svc.tick(); };
    fireAt(60_000);   // first -> 'first'
    fireAt(75_000);   // re-arm 15 s (random 0) -> 75_000
    fireAt(90_000);   // second -> 'second'
    assert.ok(texts[0].includes('first'), 'first emission is line 0');
    assert.ok(texts[1].includes('second'), 'second emission cycles to line 1');
  });

  it('start() then stop() does not throw and leaves tick() usable', () => {
    const spawn = mockSpawnManager([mover(1, 'MaFl_Boboku')]);
    const { zone } = mockZoneManager();
    const dialogs = mockDialogs([{ key: 'MaFl_Boboku', prefix: 'mafl_boboku', speak: ['hi'] }]);
    const svc = new NpcSpeechService({ spawnManager: spawn, zoneManager: zone, dialogs, now: () => 0, random: () => 0 });

    svc.start();
    svc.stop(); // clears the real interval -- must not throw
    svc.stop(); // idempotent
    // tick() still works post-stop (schedule logic independent of the timer).
    assert.doesNotThrow(() => svc.tick());
  });
});

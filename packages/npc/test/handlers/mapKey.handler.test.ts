import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { SessionState } from '@flyff/core/constants/sessionState';
import { MapKeyHandler } from '../../src/handlers/mapKey.handler';
import type { MapKeyService, MapKeyOutcome } from '../../src/services/mapKey.service';
import type { VisibilityService } from '@flyff/world-core';

function mockSocket(state: number = SessionState.IN_WORLD) {
  let destroyed = false;
  const written: Buffer[] = [];
  return {
    session: { state, charId: 42 },
    write: (b: Buffer) => { written.push(b); return true; },
    destroy: () => { destroyed = true; },
    _written: written,
    get _destroyed() { return destroyed; },
  };
}

/** Build a MAP_KEY payload (Neuz/DPClient.cpp:18620 field order). */
function mapKeyPayload(fileName: string, mapKey: string): Buffer {
  const w = new PacketWriter();
  w.writeString(fileName);
  w.writeString(mapKey);
  return w.build();
}

function fakeService(outcome: MapKeyOutcome): MapKeyService {
  return { check: () => outcome } as unknown as MapKeyService;
}

/**
 * Visibility stub. `ok=false` = unknown charId (session desync). Records calls
 * so a test can assert the handler did (or did not) open the player's view.
 */
function fakeVisibility(ok = true) {
  const calls: number[] = [];
  const svc = { enterWorld: (charId: number) => { calls.push(charId); return ok; } };
  return { svc: svc as unknown as Pick<VisibilityService, 'enterWorld'>, calls };
}

describe('MapKeyHandler', () => {
  it('opens the player view on an accepted key from an IN_WORLD session', () => {
    // The client finished loading the world (g_pWorld/g_pPlayer set) once it
    // sends MAP_KEY -- this is the safe point to stream ADD_OBJ. JOIN was too
    // early (raced world load -> OnAddObj null-deref at DPClient.cpp:1160).
    const vis = fakeVisibility();
    const handler = new MapKeyHandler(fakeService({ ok: true }), vis.svc);
    const sock = mockSocket();
    handler.handleMapKey(sock as unknown as never, new PacketReader(mapKeyPayload('W1.wld', 'abc123')));
    assert.equal(sock._destroyed, false);
    assert.deepEqual(vis.calls, [42]);
    // The handler writes nothing itself -- VisibilityService owns the sends.
    assert.equal(sock._written.length, 0);
  });

  it('destroys when the socket is not IN_WORLD', () => {
    const handler = new MapKeyHandler(fakeService({ ok: true }), fakeVisibility().svc);
    const sock = mockSocket(SessionState.CONNECTED);
    handler.handleMapKey(sock as unknown as never, new PacketReader(mapKeyPayload('W1.wld', 'abc123')));
    assert.equal(sock._destroyed, true);
    assert.equal(sock._written.length, 0);
  });

  it('destroys on a mismatch verdict without opening the view', () => {
    const vis = fakeVisibility();
    const handler = new MapKeyHandler(fakeService({ ok: false, reason: 'mismatch' }), vis.svc);
    const sock = mockSocket();
    handler.handleMapKey(sock as unknown as never, new PacketReader(mapKeyPayload('W1.wld', 'abc123')));
    assert.equal(sock._destroyed, true);
    assert.deepEqual(vis.calls, []);
  });

  it('destroys when the service reports not_in_world', () => {
    const handler = new MapKeyHandler(fakeService({ ok: false, reason: 'not_in_world' }), fakeVisibility().svc);
    const sock = mockSocket();
    handler.handleMapKey(sock as unknown as never, new PacketReader(mapKeyPayload('W1.wld', 'abc123')));
    assert.equal(sock._destroyed, true);
  });

  it('destroys when visibility cannot resolve the player (session desync)', () => {
    const handler = new MapKeyHandler(fakeService({ ok: true }), fakeVisibility(false).svc);
    const sock = mockSocket();
    handler.handleMapKey(sock as unknown as never, new PacketReader(mapKeyPayload('W1.wld', 'abc123')));
    assert.equal(sock._destroyed, true);
    assert.equal(sock._written.length, 0);
  });

  it('destroys on a truncated payload (missing second string)', () => {
    const handler = new MapKeyHandler(fakeService({ ok: true }), fakeVisibility().svc);
    const sock = mockSocket();
    const w = new PacketWriter();
    w.writeString('only-one'); // missing szMapKey
    handler.handleMapKey(sock as unknown as never, new PacketReader(w.build()));
    assert.equal(sock._destroyed, true);
  });
});

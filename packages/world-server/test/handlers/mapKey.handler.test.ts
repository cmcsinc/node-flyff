import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { SessionState } from '@flyff/core/constants/sessionState.js';
import { MapKeyHandler } from '../../src/handlers/mapKey.handler.js';
import type { MapKeyService, MapKeyOutcome } from '../../src/services/mapKey.service.js';

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

describe('MapKeyHandler', () => {
  it('accepts a well-formed key from an IN_WORLD session', () => {
    const handler = new MapKeyHandler(fakeService({ ok: true }));
    const sock = mockSocket();
    handler.handleMapKey(sock as unknown as never, new PacketReader(mapKeyPayload('W1.wld', 'abc123')));
    assert.equal(sock._destroyed, false);
    assert.equal(sock._written.length, 0);
  });

  it('destroys when the socket is not IN_WORLD', () => {
    const handler = new MapKeyHandler(fakeService({ ok: true }));
    const sock = mockSocket(SessionState.CONNECTED);
    handler.handleMapKey(sock as unknown as never, new PacketReader(mapKeyPayload('W1.wld', 'abc123')));
    assert.equal(sock._destroyed, true);
    assert.equal(sock._written.length, 0);
  });

  it('destroys on a mismatch verdict', () => {
    const handler = new MapKeyHandler(fakeService({ ok: false, reason: 'mismatch' }));
    const sock = mockSocket();
    handler.handleMapKey(sock as unknown as never, new PacketReader(mapKeyPayload('W1.wld', 'abc123')));
    assert.equal(sock._destroyed, true);
  });

  it('destroys when the service reports not_in_world', () => {
    const handler = new MapKeyHandler(fakeService({ ok: false, reason: 'not_in_world' }));
    const sock = mockSocket();
    handler.handleMapKey(sock as unknown as never, new PacketReader(mapKeyPayload('W1.wld', 'abc123')));
    assert.equal(sock._destroyed, true);
  });

  it('destroys on a truncated payload (missing second string)', () => {
    const handler = new MapKeyHandler(fakeService({ ok: true }));
    const sock = mockSocket();
    const w = new PacketWriter();
    w.writeString('only-one'); // missing szMapKey
    handler.handleMapKey(sock as unknown as never, new PacketReader(w.build()));
    assert.equal(sock._destroyed, true);
  });
});

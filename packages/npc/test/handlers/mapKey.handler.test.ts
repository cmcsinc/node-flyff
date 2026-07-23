import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { SessionState } from '@flyff/core/constants/sessionState';
import { MapKeyHandler } from '../../src/handlers/mapKey.handler';
import type { MapKeyService, MapKeyOutcome } from '../../src/services/mapKey.service';
import type { VicinityService } from '../../src/services/vicinity.service';

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

/** Vicinity stub: returns the queued result each call (null = empty/skip). */
function fakeVicinity(result: ReturnType<VicinityService['enterZone']>): VicinityService {
  return { enterZone: () => result } as unknown as VicinityService;
}

describe('MapKeyHandler', () => {
  it('accepts a well-formed key from an IN_WORLD session', () => {
    const handler = new MapKeyHandler(fakeService({ ok: true }), fakeVicinity(null));
    const sock = mockSocket();
    handler.handleMapKey(sock as unknown as never, new PacketReader(mapKeyPayload('W1.wld', 'abc123')));
    assert.equal(sock._destroyed, false);
    assert.equal(sock._written.length, 0);
  });

  it('sends the vicinity ADD_OBJ snapshot on the first accepted MAP_KEY', () => {
    // The client finished loading the world (g_pWorld/g_pPlayer set) once it
    // sends MAP_KEY -- this is the safe point to stream zone movers. JOIN was
    // too early (raced world load -> OnAddObj null-deref at DPClient.cpp:1160).
    const snap = Buffer.from([0xfe, 0xff, 0xff, 0xff, 0x2b, 0x00]); // fake SNAPSHOT head + cb=43
    const handler = new MapKeyHandler(fakeService({ ok: true }), fakeVicinity({ snapshot: snap }));
    const sock = mockSocket();
    handler.handleMapKey(sock as unknown as never, new PacketReader(mapKeyPayload('W1.wld', 'abc123')));
    assert.equal(sock._destroyed, false);
    assert.equal(sock._written.length, 1);
    // sendPacket wraps in the 0x5E + size frame (5-byte header); payload follows.
    assert.ok(sock._written[0]!.subarray(0, 5).equals(Buffer.from([0x5e, 0x06, 0x00, 0x00, 0x00])));
    assert.ok(sock._written[0]!.subarray(5).equals(snap));
  });

  it('destroys when the socket is not IN_WORLD', () => {
    const handler = new MapKeyHandler(fakeService({ ok: true }), fakeVicinity(null));
    const sock = mockSocket(SessionState.CONNECTED);
    handler.handleMapKey(sock as unknown as never, new PacketReader(mapKeyPayload('W1.wld', 'abc123')));
    assert.equal(sock._destroyed, true);
    assert.equal(sock._written.length, 0);
  });

  it('destroys on a mismatch verdict (no vicinity send)', () => {
    const handler = new MapKeyHandler(fakeService({ ok: false, reason: 'mismatch' }), fakeVicinity(null));
    const sock = mockSocket();
    handler.handleMapKey(sock as unknown as never, new PacketReader(mapKeyPayload('W1.wld', 'abc123')));
    assert.equal(sock._destroyed, true);
  });

  it('destroys when the service reports not_in_world', () => {
    const handler = new MapKeyHandler(fakeService({ ok: false, reason: 'not_in_world' }), fakeVicinity(null));
    const sock = mockSocket();
    handler.handleMapKey(sock as unknown as never, new PacketReader(mapKeyPayload('W1.wld', 'abc123')));
    assert.equal(sock._destroyed, true);
  });

  it('destroys when vicinity reports no_player (session desync)', () => {
    const handler = new MapKeyHandler(
      fakeService({ ok: true }),
      fakeVicinity({ ok: false, reason: 'no_player' }),
    );
    const sock = mockSocket();
    handler.handleMapKey(sock as unknown as never, new PacketReader(mapKeyPayload('W1.wld', 'abc123')));
    assert.equal(sock._destroyed, true);
    assert.equal(sock._written.length, 0);
  });

  it('destroys on a truncated payload (missing second string)', () => {
    const handler = new MapKeyHandler(fakeService({ ok: true }), fakeVicinity(null));
    const sock = mockSocket();
    const w = new PacketWriter();
    w.writeString('only-one'); // missing szMapKey
    handler.handleMapKey(sock as unknown as never, new PacketReader(w.build()));
    assert.equal(sock._destroyed, true);
  });
});

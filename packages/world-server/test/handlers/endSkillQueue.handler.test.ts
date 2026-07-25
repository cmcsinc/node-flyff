import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { SessionState } from '@flyff/core/constants/sessionState';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import { NULL_ID, SNAPSHOTTYPE_ENDSKILLQUEUE } from '@flyff/world-core';
import { EndSkillQueueHandler } from '../../src/handlers/endSkillQueue.handler';
import type { PlayerManager } from '@flyff/world-core';
import type { CPlayer } from '@flyff/entities';

function mockSocket(state = SessionState.IN_WORLD, charId = 42) {
  const written: Buffer[] = [];
  let destroyed = false;
  return {
    session: { state, charId },
    write: (buf: Buffer) => { written.push(buf); return true; },
    destroy: () => { destroyed = true; },
    get _destroyed() { return destroyed; },
    get _written() { return written; },
  };
}

const fakePm = (p?: CPlayer | null): PlayerManager =>
  ({ get: () => p }) as unknown as PlayerManager;
const player = { m_idPlayer: 42 } as unknown as CPlayer;

describe('EndSkillQueueHandler', () => {
  it('acks with a self-only SNAPSHOTTYPE_ENDSKILLQUEUE snapshot', () => {
    const handler = new EndSkillQueueHandler(fakePm(player));
    const sock = mockSocket();
    handler.handleEndSkillQueue(sock as never);

    assert.equal(sock._destroyed, false);
    assert.equal(sock._written.length, 1);
    const buf = sock._written[0];
    // sendPacket wraps with a 5-byte frame (0x5E marker + DWORD size); payload starts at offset 5.
    const o = 5;
    assert.equal(buf.readUInt32LE(o), PACKETTYPE.SNAPSHOT);
    assert.equal(buf.readUInt32LE(o + 4), NULL_ID);
    assert.equal(buf.readUInt16LE(o + 8), 1);              // count
    assert.equal(buf.readUInt32LE(o + 10), 42);            // objid == m_idPlayer
    assert.equal(buf.readUInt16LE(o + 14), SNAPSHOTTYPE_ENDSKILLQUEUE);
  });

  it('destroys when not IN_WORLD', () => {
    const handler = new EndSkillQueueHandler(fakePm(player));
    const sock = mockSocket(SessionState.CONNECTED);
    handler.handleEndSkillQueue(sock as never);
    assert.equal(sock._destroyed, true);
    assert.equal(sock._written.length, 0);
  });

  it('destroys when the player is not live', () => {
    const handler = new EndSkillQueueHandler(fakePm(null));
    const sock = mockSocket();
    handler.handleEndSkillQueue(sock as never);
    assert.equal(sock._destroyed, true);
    assert.equal(sock._written.length, 0);
  });
});

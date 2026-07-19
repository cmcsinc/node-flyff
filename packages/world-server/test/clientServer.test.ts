import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildWorldClientServer } from '../src/clientServer.js';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import type { JoinHandler } from '../src/handlers/join.handler.js';

describe('buildWorldClientServer', () => {
  it('registers the JOIN opcode against the join handler', () => {
    const fake = { handleJoin: () => {} } as unknown as JoinHandler;
    const { dispatcher, server } = buildWorldClientServer({ joinHandler: fake });
    assert.equal(dispatcher.hasHandler(PACKETTYPE.JOIN), true);
    assert.equal(dispatcher.hasHandler(PACKETTYPE.CERTIFY), false);
    server.close();
  });
});

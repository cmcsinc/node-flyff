import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildWorldClientServer } from '../src/clientServer';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';
import type { JoinHandler } from '../src/handlers/join.handler';

describe('buildWorldClientServer', () => {
  it('registers the JOIN opcode against the join handler', () => {
    const fake = { handleJoin: () => {} } as unknown as JoinHandler;
    const { dispatcher, server } = buildWorldClientServer({ joinHandler: fake });
    assert.equal(dispatcher.hasHandler(PACKETTYPE.JOIN), true);
    assert.equal(dispatcher.hasHandler(PACKETTYPE.CERTIFY), false);
    server.close();
  });
});

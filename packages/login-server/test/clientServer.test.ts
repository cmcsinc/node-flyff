import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildLoginClientServer } from '../src/clientServer.js';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import type { AuthHandler } from '../src/handlers/auth.handler.js';

describe('buildLoginClientServer', () => {
  it('registers the CERTIFY opcode against the auth handler', () => {
    const fakeAuth = { handleCertify: () => {} } as unknown as AuthHandler;
    const { dispatcher, server } = buildLoginClientServer({ authHandler: fakeAuth });
    assert.equal(dispatcher.hasHandler(PACKETTYPE.CERTIFY), true);
    assert.equal(dispatcher.hasHandler(PACKETTYPE.JOIN), false);
    server.close();
  });
});

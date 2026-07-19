import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildClusterClientServer } from '../src/clientServer.js';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import type { CharHandler } from '../src/handlers/char.handler.js';

describe('buildClusterClientServer', () => {
  it('registers the four character-packet opcodes', () => {
    const fake = {
      handleGetPlayerList: () => {}, handleCreatePlayer: () => {},
      handleDeletePlayer: () => {}, handlePreJoin: () => {},
    } as unknown as CharHandler;
    const { dispatcher, server } = buildClusterClientServer({ charHandler: fake });
    assert.equal(dispatcher.hasHandler(PACKETTYPE.GETPLAYERLIST), true);
    assert.equal(dispatcher.hasHandler(PACKETTYPE.CREATE_PLAYER), true);
    assert.equal(dispatcher.hasHandler(PACKETTYPE.DELETE_PLAYER), true);
    assert.equal(dispatcher.hasHandler(PACKETTYPE.PRE_JOIN), true);
    assert.equal(dispatcher.hasHandler(PACKETTYPE.CERTIFY), false);
    assert.equal(dispatcher.hasHandler(PACKETTYPE.JOIN), false);
    server.close();
  });
});

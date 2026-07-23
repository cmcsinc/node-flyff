import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { LeaveHandler } from '../../src/handlers/leave.handler';

function mockSocket() {
  let destroyed = false;
  return {
    session: { charId: 42 },
    destroy: () => { destroyed = true; },
    get _destroyed() { return destroyed; },
  };
}

describe('LeaveHandler', () => {
  it('destroys the socket on LEAVE', () => {
    const handler = new LeaveHandler();
    const sock = mockSocket();
    handler.handleLeave(sock as never);
    assert.equal(sock._destroyed, true);
  });

  it('does not throw when session is missing', () => {
    const handler = new LeaveHandler();
    const sock = { destroy() {} };
    handler.handleLeave(sock as never);
  });
});

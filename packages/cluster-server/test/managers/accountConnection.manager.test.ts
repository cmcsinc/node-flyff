import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { AccountConnectionManager } from '../../src/managers/accountConnection.manager';

/** Minimal net.Socket stub: just the close-event surface `bind()` touches. */
function makeSocket(): any {
  const ee = new EventEmitter();
  return {
    _ee: ee,
    once: (ev: string, fn: () => void) => ee.once(ev, fn),
    destroy: () => ee.emit('close'),
  };
}

describe('AccountConnectionManager', () => {
  it('binds an account to its first socket', () => {
    const mgr = new AccountConnectionManager();
    const sock = makeSocket();
    assert.equal(mgr.bind('alice', sock), null);
    assert.equal(mgr.get('alice'), sock);
    assert.equal(mgr.size, 1);
  });

  it('destroys the stale socket when the same account reconnects', () => {
    const mgr = new AccountConnectionManager();
    const stale = makeSocket();
    const fresh = makeSocket();
    let staleDestroyed = false;
    stale.destroy = () => { staleDestroyed = true; };

    mgr.bind('alice', stale);
    const displaced = mgr.bind('alice', fresh);

    assert.equal(displaced, stale);
    assert.ok(staleDestroyed, 'stale socket must be destroyed');
    assert.equal(mgr.get('alice'), fresh);
    assert.equal(mgr.size, 1);
  });

  it('frees the account when its socket closes', () => {
    const mgr = new AccountConnectionManager();
    const sock = makeSocket();
    mgr.bind('alice', sock);
    assert.equal(mgr.size, 1);

    sock.destroy(); // emits 'close'
    assert.equal(mgr.get('alice'), null);
    assert.equal(mgr.size, 0);
  });

  it('does not clear a newer binding when an older socket closes', () => {
    const mgr = new AccountConnectionManager();
    const stale = makeSocket();
    const fresh = makeSocket();
    mgr.bind('alice', stale);
    mgr.bind('alice', fresh); // stale.destroy() fires here, but the listener is
    // attached to `stale`; the close handler guards "still owner?" so a late
    // close from `stale` must not evict `fresh`.
    stale._ee.emit('close');

    assert.equal(mgr.get('alice'), fresh);
    assert.equal(mgr.size, 1);
  });
});

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import { CheckpointSystem } from '../../src/systems/checkpoint.system.js';

/**
 * CheckpointSystem -- exercised with node:test mock.timers so the 30 s cadence
 * is advanced deterministically without real waiting (rule 06).
 */
describe('CheckpointSystem', () => {
  beforeEach(() => mock.timers.enable());
  afterEach(() => mock.timers.reset());

  it('invokes flush once per 30 s tick', () => {
    let calls = 0;
    const sys = new CheckpointSystem({ flush: () => { calls++; } });
    sys.start();
    assert.equal(calls, 0);
    mock.timers.tick(30_000);
    assert.equal(calls, 1);
    mock.timers.tick(30_000);
    assert.equal(calls, 2);
    sys.stop();
  });

  it('stop() halts the loop and is idempotent; start() is idempotent', () => {
    let calls = 0;
    const sys = new CheckpointSystem({ flush: () => { calls++; } });
    sys.start();
    sys.start(); // second start must not stack a second timer
    mock.timers.tick(30_000);
    assert.equal(calls, 1, 'only one timer firing per interval');
    sys.stop();
    sys.stop(); // second stop is a no-op
    mock.timers.tick(60_000);
    assert.equal(calls, 1, 'no further ticks after stop');
  });

  it('survives a throwing flush -- the next tick still fires', () => {
    let calls = 0;
    const sys = new CheckpointSystem({
      flush: () => {
        calls++;
        if (calls === 1) throw new Error('boom');
      },
    });
    sys.start();
    mock.timers.tick(30_000); // first flush throws, must be contained
    mock.timers.tick(30_000); // loop still alive
    assert.equal(calls, 2);
    sys.stop();
  });
});

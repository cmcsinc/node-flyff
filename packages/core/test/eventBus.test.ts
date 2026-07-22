/**
 * Tests for packages/core/src/eventBus.ts
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { createEventBus } from '../src/eventBus.js';
import type { EventBus } from '../src/eventBus.js';

type TestEvents = {
  'ping': [];
  'value': [n: number];
  'multi': [a: string, b: number, c: boolean];
};

describe('createEventBus', () => {
  it('returns an object with on, off, once, emit', () => {
    const bus = createEventBus<TestEvents>();
    assert.equal(typeof bus.on, 'function');
    assert.equal(typeof bus.off, 'function');
    assert.equal(typeof bus.once, 'function');
    assert.equal(typeof bus.emit, 'function');
  });

  it('emit fires a registered on() listener', () => {
    const bus = createEventBus<TestEvents>();
    let called = 0;
    bus.on('ping', () => { called++; });
    bus.emit('ping');
    assert.equal(called, 1);
  });

  it('passes arguments to the listener', () => {
    const bus = createEventBus<TestEvents>();
    const received: number[] = [];
    bus.on('value', (n) => { received.push(n); });
    bus.emit('value', 42);
    bus.emit('value', 7);
    assert.deepEqual(received, [42, 7]);
  });

  it('passes multiple arguments correctly', () => {
    const bus = createEventBus<TestEvents>();
    let captured: [string, number, boolean] | null = null;
    bus.on('multi', (a, b, c) => { captured = [a, b, c]; });
    bus.emit('multi', 'hello', 99, true);
    assert.deepEqual(captured, ['hello', 99, true]);
  });

  it('off() removes the listener so it is not called', () => {
    const bus = createEventBus<TestEvents>();
    let called = 0;
    const handler = () => { called++; };
    bus.on('ping', handler);
    bus.off('ping', handler);
    bus.emit('ping');
    assert.equal(called, 0);
  });

  it('off() only removes the specified listener', () => {
    const bus = createEventBus<TestEvents>();
    let countA = 0;
    let countB = 0;
    const handlerA = () => { countA++; };
    const handlerB = () => { countB++; };
    bus.on('ping', handlerA);
    bus.on('ping', handlerB);
    bus.off('ping', handlerA);
    bus.emit('ping');
    assert.equal(countA, 0);
    assert.equal(countB, 1);
  });

  it('once() fires exactly once', () => {
    const bus = createEventBus<TestEvents>();
    let called = 0;
    bus.once('ping', () => { called++; });
    bus.emit('ping');
    bus.emit('ping');
    bus.emit('ping');
    assert.equal(called, 1);
  });

  it('once() passes arguments on the single call', () => {
    const bus = createEventBus<TestEvents>();
    let captured: number | null = null;
    bus.once('value', (n) => { captured = n; });
    bus.emit('value', 123);
    assert.equal(captured, 123);
  });

  it('emit returns false when no listeners are registered', () => {
    const bus = createEventBus<TestEvents>();
    const result = bus.emit('ping');
    assert.equal(result, false);
  });

  it('emit returns true when at least one listener is registered', () => {
    const bus = createEventBus<TestEvents>();
    bus.on('ping', () => { /* noop */ });
    const result = bus.emit('ping');
    assert.equal(result, true);
  });

  it('multiple listeners on the same event all fire', () => {
    const bus = createEventBus<TestEvents>();
    const log: number[] = [];
    bus.on('value', (n) => { log.push(n * 1); });
    bus.on('value', (n) => { log.push(n * 2); });
    bus.emit('value', 5);
    assert.deepEqual(log, [5, 10]);
  });

  it('EventBus type is assignable to a typed variable', () => {
    // This is a compile-time check -- if it compiles, the type is correct.
    const bus: EventBus<TestEvents> = createEventBus<TestEvents>();
    assert.ok(bus !== null);
  });
});

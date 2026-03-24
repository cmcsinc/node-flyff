/**
 * Tests for packages/core/src/errors.ts
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { FlyffError, PacketError, AuthError, GameError } from './errors.js';

describe('FlyffError', () => {
  it('is an instance of Error', () => {
    const err = new FlyffError('test', 'TEST_CODE');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof FlyffError);
  });

  it('sets name to constructor name', () => {
    const err = new FlyffError('test', 'TEST_CODE');
    assert.equal(err.name, 'FlyffError');
  });

  it('stores the code', () => {
    const err = new FlyffError('test', 'MY_CODE');
    assert.equal(err.code, 'MY_CODE');
  });

  it('stores the message', () => {
    const err = new FlyffError('hello world', 'X');
    assert.equal(err.message, 'hello world');
  });

  it('chains the cause when provided', () => {
    const cause = new Error('root cause');
    const err = new FlyffError('wrapper', 'X', cause);
    assert.equal(err.cause, cause);
  });

  it('does not set cause when omitted', () => {
    const err = new FlyffError('no cause', 'X');
    assert.equal(err.cause, undefined);
  });
});

describe('PacketError', () => {
  it('is instanceof FlyffError and Error', () => {
    const err = new PacketError('bad packet');
    assert.ok(err instanceof PacketError);
    assert.ok(err instanceof FlyffError);
    assert.ok(err instanceof Error);
  });

  it('has code PACKET_ERROR', () => {
    const err = new PacketError('bad packet');
    assert.equal(err.code, 'PACKET_ERROR');
  });

  it('name equals PacketError', () => {
    const err = new PacketError('bad packet');
    assert.equal(err.name, 'PacketError');
  });

  it('accepts a cause', () => {
    const inner = new RangeError('slot out of range');
    const err = new PacketError('invalid slot', inner);
    assert.equal(err.cause, inner);
  });
});

describe('AuthError', () => {
  it('is instanceof FlyffError and Error', () => {
    const err = new AuthError('bad credentials');
    assert.ok(err instanceof AuthError);
    assert.ok(err instanceof FlyffError);
    assert.ok(err instanceof Error);
  });

  it('has code AUTH_ERROR', () => {
    const err = new AuthError('bad credentials');
    assert.equal(err.code, 'AUTH_ERROR');
  });

  it('name equals AuthError', () => {
    const err = new AuthError('bad credentials');
    assert.equal(err.name, 'AuthError');
  });

  it('accepts a cause', () => {
    const inner = new Error('db failure');
    const err = new AuthError('login failed', inner);
    assert.equal(err.cause, inner);
  });
});

describe('GameError', () => {
  it('is instanceof FlyffError and Error', () => {
    const err = new GameError('insufficient gold');
    assert.ok(err instanceof GameError);
    assert.ok(err instanceof FlyffError);
    assert.ok(err instanceof Error);
  });

  it('has code GAME_ERROR', () => {
    const err = new GameError('insufficient gold');
    assert.equal(err.code, 'GAME_ERROR');
  });

  it('name equals GameError', () => {
    const err = new GameError('insufficient gold');
    assert.equal(err.name, 'GameError');
  });

  it('accepts a cause', () => {
    const inner = new Error('inventory locked');
    const err = new GameError('cannot use item', inner);
    assert.equal(err.cause, inner);
  });
});

describe('Error subtype discrimination', () => {
  it('PacketError is not instanceof AuthError', () => {
    const err = new PacketError('bad packet');
    assert.ok(!(err instanceof AuthError));
    assert.ok(!(err instanceof GameError));
  });

  it('AuthError is not instanceof PacketError', () => {
    const err = new AuthError('bad auth');
    assert.ok(!(err instanceof PacketError));
    assert.ok(!(err instanceof GameError));
  });
});

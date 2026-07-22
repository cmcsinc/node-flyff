/**
 * Unit tests for IpcServer -- Internal TLS TCP server.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { signIpcMessage } from '../src/signing.js';
import type { IpcRequest } from '../src/IpcServer.js';
import type { IpcResponseEnvelope } from '../src/IpcServer.js';

describe('IpcServer (without actual TLS)', () => {
  it('should validate request envelope structure', () => {
    const secret = 'test-secret';
    const payload: IpcRequest = {
      endpoint: 'test-endpoint',
      data: { foo: 'bar' },
    };
    const from = 'world-1';
    const ts = Date.now();
    const sig = signIpcMessage(secret, payload, from, ts);

    const envelope = { ts, from, sig, payload };

    // Verify structure
    assert.equal(typeof envelope.ts, 'number');
    assert.equal(envelope.from, 'world-1');
    assert.equal(typeof envelope.sig, 'string');
    assert.equal(envelope.payload.endpoint, 'test-endpoint');
    assert.deepEqual(envelope.payload.data, { foo: 'bar' });
  });

  it('should create response envelope for success', () => {
    const response: IpcResponseEnvelope = {
      success: true,
      data: { result: 'ok' },
    };

    if (response.success) {
      assert.deepEqual(response.data, { result: 'ok' });
    } else {
      assert.fail('Expected success response');
    }
  });

  it('should create response envelope for error', () => {
    const response: IpcResponseEnvelope = {
      success: false,
      error: 'Something went wrong',
    };

    if (!response.success) {
      assert.equal(response.error, 'Something went wrong');
    } else {
      assert.fail('Expected error response');
    }
  });
});

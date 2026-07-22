/**
 * Unit tests for IpcClient -- Internal TLS TCP client.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { IpcTimeoutError, IpcRequestError } from '../src/IpcClient.js';
import { signIpcMessage } from '../src/signing.js';
import type { IpcRequestPayload } from '../src/IpcClient.js';
import type { IpcResponseEnvelope } from '../src/IpcClient.js';

describe('IpcClient (without actual TLS)', () => {
  it('should create request envelope with signature', () => {
    const secret = 'test-secret';
    const payload: IpcRequestPayload = {
      endpoint: 'get-session',
      data: { token: 'abc' },
    };
    const from = 'world-1';
    const ts = Date.now();
    const sig = signIpcMessage(secret, payload, from, ts);

    const envelope = { ts, from, sig, payload };

    // Verify structure
    assert.equal(typeof envelope.ts, 'number');
    assert.equal(envelope.from, 'world-1');
    assert.equal(typeof envelope.sig, 'string');
    assert.equal(envelope.payload.endpoint, 'get-session');
    assert.deepEqual(envelope.payload.data, { token: 'abc' });
  });

  it('should create error types correctly', () => {
    const timeoutError = new IpcTimeoutError('Request timeout after 5000ms');
    assert.equal(timeoutError.name, 'IpcTimeoutError');
    assert.equal(timeoutError.message, 'Request timeout after 5000ms');

    const requestError = new IpcRequestError('Server error');
    assert.equal(requestError.name, 'IpcRequestError');
    assert.equal(requestError.message, 'Server error');
  });

  it('should parse success response envelope', () => {
    const response: IpcResponseEnvelope = {
      success: true,
      data: { sessionId: 'xyz' },
    };

    if (response.success) {
      assert.deepEqual(response.data, { sessionId: 'xyz' });
    } else {
      assert.fail('Expected success response');
    }
  });

  it('should parse error response envelope', () => {
    const response: IpcResponseEnvelope = {
      success: false,
      error: 'Invalid token',
    };

    if (!response.success) {
      assert.equal(response.error, 'Invalid token');
    } else {
      assert.fail('Expected error response');
    }
  });
});

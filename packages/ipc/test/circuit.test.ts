/**
 * Unit tests for circuit.ts — CircuitBreaker pattern.
 */

import { describe, it, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import { CircuitBreaker, CircuitOpenError, type CircuitState } from '../src/circuit.js';

describe('CircuitBreaker', () => {
  it('should start in CLOSED state', () => {
    const breaker = new CircuitBreaker();

    assert.strictEqual(breaker.getState(), 'CLOSED');
    assert.strictEqual(breaker.getFailureCount(), 0);
  });

  it('should execute calls successfully when CLOSED', async () => {
    const breaker = new CircuitBreaker();

    const result = await breaker.call(async () => {
      return 'success';
    });

    assert.strictEqual(result, 'success');
    assert.strictEqual(breaker.getState(), 'CLOSED');
    assert.strictEqual(breaker.getFailureCount(), 0);
  });

  it('should track failures and open circuit after threshold', async () => {
    const breaker = new CircuitBreaker({ threshold: 3 });

    // Fail 3 times to reach threshold
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.call(async () => {
          throw new Error('Test failure');
        });
      } catch {
        // Expected to throw
      }
    }

    assert.strictEqual(breaker.getState(), 'OPEN');
    assert.strictEqual(breaker.getFailureCount(), 3);
  });

  it('should reject calls immediately when OPEN', async () => {
    const breaker = new CircuitBreaker({ threshold: 2 });

    // Open the circuit
    try {
      await breaker.call(async () => {
        throw new Error('Test failure');
      });
    } catch {
      // Expected
    }
    try {
      await breaker.call(async () => {
        throw new Error('Test failure');
      });
    } catch {
      // Expected
    }

    // Circuit should now be OPEN
    assert.strictEqual(breaker.getState(), 'OPEN');

    // Next call should fail immediately without executing
    let executed = false;
    try {
      await breaker.call(async () => {
        executed = true;
        return 'should not execute';
      });
    } catch (err) {
      assert.ok(err instanceof CircuitOpenError);
    }

    assert.strictEqual(executed, false);
  });

  it('should transition to HALF_OPEN after reset timeout', async () => {
    const breaker = new CircuitBreaker({ threshold: 2, resetMs: 100 });

    // Open the circuit
    try {
      await breaker.call(async () => {
        throw new Error('Test failure');
      });
    } catch {
      // Expected
    }
    try {
      await breaker.call(async () => {
        throw new Error('Test failure');
      });
    } catch {
      // Expected
    }

    assert.strictEqual(breaker.getState(), 'OPEN');

    // Wait for reset timeout
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Next call should transition to HALF_OPEN and execute
    const result = await breaker.call(async () => {
      return 'success';
    });

    assert.strictEqual(result, 'success');
    assert.strictEqual(breaker.getState(), 'CLOSED');
    assert.strictEqual(breaker.getFailureCount(), 0);
  });

  it('should return to OPEN if HALF_OPEN call fails', async () => {
    const breaker = new CircuitBreaker({ threshold: 2, resetMs: 100 });

    // Open the circuit
    try {
      await breaker.call(async () => {
        throw new Error('Test failure');
      });
    } catch {
      // Expected
    }
    try {
      await breaker.call(async () => {
        throw new Error('Test failure');
      });
    } catch {
      // Expected
    }

    assert.strictEqual(breaker.getState(), 'OPEN');

    // Wait for reset timeout
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Fail in HALF_OPEN state
    try {
      await breaker.call(async () => {
        throw new Error('Test failure in HALF_OPEN');
      });
    } catch {
      // Expected
    }

    // Should return to OPEN
    assert.strictEqual(breaker.getState(), 'OPEN');
  });

  it('should reset failure count on success', async () => {
    const breaker = new CircuitBreaker({ threshold: 3 });

    // Fail twice
    try {
      await breaker.call(async () => {
        throw new Error('Test failure');
      });
    } catch {
      // Expected
    }
    try {
      await breaker.call(async () => {
        throw new Error('Test failure');
      });
    } catch {
      // Expected
    }

    assert.strictEqual(breaker.getFailureCount(), 2);

    // Succeed
    await breaker.call(async () => {
      return 'success';
    });

    assert.strictEqual(breaker.getFailureCount(), 0);
    assert.strictEqual(breaker.getState(), 'CLOSED');
  });

  it('should allow custom threshold', async () => {
    const breaker = new CircuitBreaker({ threshold: 5 });

    // Fail 4 times (below threshold)
    for (let i = 0; i < 4; i++) {
      try {
        await breaker.call(async () => {
          throw new Error('Test failure');
        });
      } catch {
        // Expected
      }
    }

    assert.strictEqual(breaker.getState(), 'CLOSED');
    assert.strictEqual(breaker.getFailureCount(), 4);

    // One more failure to open
    try {
      await breaker.call(async () => {
        throw new Error('Test failure');
      });
    } catch {
      // Expected
    }

    assert.strictEqual(breaker.getState(), 'OPEN');
  });

  it('should allow custom reset timeout', async () => {
    const breaker = new CircuitBreaker({ threshold: 2, resetMs: 50 });

    // Open the circuit
    try {
      await breaker.call(async () => {
        throw new Error('Test failure');
      });
    } catch {
      // Expected
    }
    try {
      await breaker.call(async () => {
        throw new Error('Test failure');
      });
    } catch {
      // Expected
    }

    assert.strictEqual(breaker.getState(), 'OPEN');

    // Wait less than reset timeout
    await new Promise((resolve) => setTimeout(resolve, 30));

    // Should still be OPEN
    try {
      await breaker.call(async () => {
        return 'should not execute';
      });
    } catch (err) {
      assert.ok(err instanceof CircuitOpenError);
    }

    assert.strictEqual(breaker.getState(), 'OPEN');

    // Wait for reset timeout
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should now transition to HALF_OPEN
    await breaker.call(async () => {
      return 'success';
    });

    assert.strictEqual(breaker.getState(), 'CLOSED');
  });

  it('should support manual reset', async () => {
    const breaker = new CircuitBreaker({ threshold: 2 });

    // Open the circuit
    try {
      await breaker.call(async () => {
        throw new Error('Test failure');
      });
    } catch {
      // Expected
    }
    try {
      await breaker.call(async () => {
        throw new Error('Test failure');
      });
    } catch {
      // Expected
    }

    assert.strictEqual(breaker.getState(), 'OPEN');

    // Manually reset
    breaker.reset();

    assert.strictEqual(breaker.getState(), 'CLOSED');
    assert.strictEqual(breaker.getFailureCount(), 0);

    // Should now execute calls
    const result = await breaker.call(async () => {
      return 'success';
    });

    assert.strictEqual(result, 'success');
  });

  it('should support manual open', async () => {
    const breaker = new CircuitBreaker();

    assert.strictEqual(breaker.getState(), 'CLOSED');

    breaker.open();

    assert.strictEqual(breaker.getState(), 'OPEN');

    // Should reject calls
    try {
      await breaker.call(async () => {
        return 'should not execute';
      });
    } catch (err) {
      assert.ok(err instanceof CircuitOpenError);
    }
  });

  it('should use default threshold of 5', async () => {
    const breaker = new CircuitBreaker();

    // Fail 4 times (below default threshold)
    for (let i = 0; i < 4; i++) {
      try {
        await breaker.call(async () => {
          throw new Error('Test failure');
        });
      } catch {
        // Expected
      }
    }

    assert.strictEqual(breaker.getState(), 'CLOSED');

    // One more to open
    try {
      await breaker.call(async () => {
        throw new Error('Test failure');
      });
    } catch {
      // Expected
    }

    assert.strictEqual(breaker.getState(), 'OPEN');
  });

  it('should use default reset timeout of 30 seconds', async () => {
    const breaker = new CircuitBreaker({ threshold: 2 });

    // Open the circuit
    try {
      await breaker.call(async () => {
        throw new Error('Test failure');
      });
    } catch {
      // Expected
    }
    try {
      await breaker.call(async () => {
        throw new Error('Test failure');
      });
    } catch {
      // Expected
    }

    const openTime = Date.now();
    assert.strictEqual(breaker.getState(), 'OPEN');

    // Wait 1 second (well below 30s default)
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Should still be OPEN
    try {
      await breaker.call(async () => {
        return 'should not execute';
      });
    } catch (err) {
      assert.ok(err instanceof CircuitOpenError);
    }

    assert.strictEqual(breaker.getState(), 'OPEN');

    // Manually reset for cleanup
    breaker.reset();
  });

  it('should handle async errors properly', async () => {
    const breaker = new CircuitBreaker({ threshold: 2 });

    let callCount = 0;

    // Fail with async error
    try {
      await breaker.call(async () => {
        callCount++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        throw new Error('Async error');
      });
    } catch {
      // Expected
    }

    assert.strictEqual(callCount, 1);
    assert.strictEqual(breaker.getFailureCount(), 1);
  });

  it('should preserve error type from thrown errors', async () => {
    class CustomError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'CustomError';
      }
    }

    const breaker = new CircuitBreaker();

    try {
      await breaker.call(async () => {
        throw new CustomError('Custom error message');
      });
    } catch (err) {
      assert.ok(err instanceof CustomError);
      assert.strictEqual(err.message, 'Custom error message');
    }
  });

  it('should handle synchronous errors', async () => {
    const breaker = new CircuitBreaker();

    try {
      await breaker.call(() => {
        throw new Error('Sync error');
      });
    } catch (err) {
      assert.ok(err instanceof Error);
      assert.strictEqual(err.message, 'Sync error');
    }

    assert.strictEqual(breaker.getFailureCount(), 1);
  });
});

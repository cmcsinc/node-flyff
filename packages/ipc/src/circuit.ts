/**
 * Circuit Breaker pattern for resilient IPC calls.
 *
 * Prevents cascading failures by fast-failing calls to a service
 * that is repeatedly failing. After a threshold of failures, the
 * circuit "opens" and rejects calls immediately without attempting them.
 * After a reset timeout, the circuit enters "half-open" state and
 * allows a single test call to see if the service has recovered.
 *
 * @module circuit
 */

/**
 * Custom error thrown when the circuit breaker is OPEN.
 * Callers should catch this specific error to handle circuit-open scenarios.
 */
export class CircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitOpenError';
  }
}

/**
 * Circuit Breaker states.
 *
 * - CLOSED: Normal operation, calls are executed
 * - OPEN: Fast-fail mode, calls are rejected immediately
 * - HALF_OPEN: Test mode, one call allowed to check if service recovered
 */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * Circuit Breaker configuration options.
 */
export interface CircuitBreakerOptions {
  /**
   * Number of consecutive failures before opening the circuit.
   * @default 5
   */
  threshold?: number;

  /**
   * Milliseconds to wait before attempting a recovery (moving from OPEN to HALF_OPEN).
   * @default 30000 (30 seconds)
   */
  resetMs?: number;
}

/**
 * Circuit Breaker implementation.
 *
 * Tracks failures and prevents cascading failures by fast-failing
 * when a service is repeatedly unavailable.
 *
 * @example
 * ```ts
 * const breaker = new CircuitBreaker({ threshold: 5, resetMs: 30000 });
 *
 * try {
 *   const result = await breaker.call(() => ipcClient.request('get-session', { token }));
 *   // Success - circuit resets to CLOSED
 * } catch (err) {
 *   if (err instanceof CircuitOpenError) {
 *     // Circuit is OPEN - use fallback or cached data
 *   } else {
 *     // Other error - count as failure
 *   }
 * }
 * ```
 */
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: CircuitState = 'CLOSED';

  constructor(private options: CircuitBreakerOptions = {}) {}

  /**
   * Execute a function through the circuit breaker.
   *
   * If the circuit is CLOSED, the function is executed normally.
   * If the circuit is OPEN, CircuitOpenError is thrown immediately.
   * If the circuit is HALF_OPEN, the function is executed once to test recovery.
   *
   * On success, the failure count resets and circuit closes.
   * On failure, the failure count increments and circuit may open.
   *
   * @param fn - Async function to execute
   * @returns Result of the function
   * @throws CircuitOpenError if circuit is OPEN
   * @throws Original error if function fails
   */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    // Check if we should attempt a reset
    if (this.state === 'OPEN') {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;
      const resetMs = this.options.resetMs ?? 30_000;

      if (timeSinceLastFailure > resetMs) {
        // Transition to HALF_OPEN to test if service has recovered
        this.state = 'HALF_OPEN';
      } else {
        // Circuit is still OPEN - fast-fail
        throw new CircuitOpenError('Circuit breaker is OPEN');
      }
    }

    try {
      // Attempt the call
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  /**
   * Handle a successful call.
   *
   * Resets failure count and closes the circuit.
   */
  private onSuccess(): void {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  /**
   * Handle a failed call.
   *
   * Increments failure count and may open the circuit if threshold is reached.
   */
  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    const threshold = this.options.threshold ?? 5;
    if (this.failures >= threshold) {
      this.state = 'OPEN';
    }
  }

  /**
   * Get the current circuit state.
   *
   * @returns Current state (CLOSED, OPEN, or HALF_OPEN)
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get the current failure count.
   *
   * @returns Number of consecutive failures
   */
  getFailureCount(): number {
    return this.failures;
  }

  /**
   * Manually reset the circuit to CLOSED state.
   *
   * Clears failure count and allows calls immediately.
   * Useful for testing or manual recovery.
   */
  reset(): void {
    this.failures = 0;
    this.state = 'CLOSED';
    this.lastFailureTime = 0;
  }

  /**
   * Manually open the circuit.
   *
   * Forces the circuit into OPEN state.
   * Useful for testing or manual maintenance.
   */
  open(): void {
    this.state = 'OPEN';
    this.lastFailureTime = Date.now();
  }
}

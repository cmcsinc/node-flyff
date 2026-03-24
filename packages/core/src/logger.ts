/**
 * Pino logger factory for the Flyff emulator.
 *
 * ## Usage
 * ```ts
 * import { createLogger } from '@flyff/core/logger';
 *
 * const logger = createLogger({ service: 'login-server', charId: 42 });
 * logger.info({ action: 'login' }, 'Player authenticated');
 * ```
 *
 * In test environments (`NODE_ENV === 'test'`) the logger is silenced
 * automatically so tests produce no noise.
 *
 * @module logger
 */

import pino from 'pino';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A pino Logger instance — re-exported so callers need not import pino directly. */
export type { Logger } from 'pino';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a pino logger with the given context merged as base bindings.
 *
 * @param context - Structured fields that appear on every log line produced
 *   by this logger instance (e.g. `{ service: 'world-server', zone: 'flaris' }`).
 * @returns A fully configured `pino.Logger` instance.
 */
export function createLogger(context: Record<string, unknown>): pino.Logger {
  const isTest = process.env['NODE_ENV'] === 'test';

  if (isTest) {
    return pino({ level: 'silent' }).child(context);
  }

  const level = resolveLogLevel();

  return pino({ level }).child(context);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the log level from the environment.
 * Falls back to `'info'` if `LOG_LEVEL` is absent or invalid.
 */
function resolveLogLevel(): pino.LevelWithSilent {
  const valid: ReadonlySet<string> = new Set([
    'trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent',
  ]);
  const raw = process.env['LOG_LEVEL'] ?? '';
  return valid.has(raw) ? (raw as pino.LevelWithSilent) : 'info';
}

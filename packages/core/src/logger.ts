/**
 * Pino logger factory for the Flyff emulator.
 *
 * ## Output format
 * - **Test** (`NODE_ENV === 'test'`): silent.
 * - **Dev / TTY** (or `LOG_PRETTY=1`): colored, human-readable via `pino-pretty`.
 * - **Prod / non-TTY** (`LOG_PRETTY=0` or piped): raw newline-delimited JSON.
 *
 * `NO_COLOR` (any value) forces JSON regardless of TTY. The pretty stream runs
 * **in-process** (not as a transport worker) so a function `messageFormat`
 * works — the module/service tag is rendered inline with each message.
 *
 * ## Usage
 * ```ts
 * import { createLogger } from '@flyff/core/logger';
 *
 * const logger = createLogger({ module: 'combat-service' });
 * logger.info({ charId: 5, exp: 2 }, 'EXP granted');
 * // → 12:34:56.789 INFO [combat-service] EXP granted
 * //     charId: 5
 * //     exp: 2
 * ```
 *
 * @module logger
 */

import pino from 'pino';
import pretty from 'pino-pretty';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A pino Logger instance — re-exported so callers need not import pino directly. */
export type { Logger } from 'pino';

// ---------------------------------------------------------------------------
// Pretty-root cache
// ---------------------------------------------------------------------------

/**
 * Single shared root behind the in-process pretty stream. Building one stream
 * avoids per-call overhead and keeps a single colorized destination.
 */
let prettyRoot: pino.Logger | null = null;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a pino logger with the given context merged as base bindings.
 *
 * @param context - Structured fields that appear on every log line produced
 *   by this logger instance. A `module` (or `service`/`system`) key, if
 *   present, is rendered as a dimmed `[tag]` prefix on the message line.
 * @returns A fully configured `pino.Logger` instance.
 */
export function createLogger(context: Record<string, unknown>): pino.Logger {
  if (process.env['NODE_ENV'] === 'test') {
    return pino({ level: 'silent' }).child(context);
  }

  const level = resolveLogLevel();

  if (!shouldPretty()) {
    return pino({ level }).child(context);
  }

  if (prettyRoot === null) {
    prettyRoot = pino({ level }, prettyStream());
  }

  const child = prettyRoot.child(context);
  child.level = level;
  return child;
}

// ---------------------------------------------------------------------------
// Pretty stream
// ---------------------------------------------------------------------------

/** Level → colorette color. Explicit for stability across pino-pretty versions. */
const LEVEL_COLORS = 'trace:gray,debug:blue,info:green,warn:yellow,error:red,fatal:magentaBright';

/** pino-pretty options — colors, compact timestamp, no pid/hostname noise. */
function prettyStream(): ReturnType<typeof pretty> {
  return pretty({
    colorize: true,
    singleLine: true,
    translateTime: 'HH:MM:ss.l',
    ignore: 'pid,hostname',
    customColors: LEVEL_COLORS,
    messageFormat(log, messageKey, _levelLabel, extras) {
      const msg = String(log[messageKey] ?? '');
      const tag = log['module'] ?? log['service'] ?? log['system'];
      if (tag === undefined || tag === '') return msg;
      return `${extras.colors.gray(`[${String(tag)}]`)} ${msg}`;
    },
  });
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

/**
 * Decides whether to emit colored human-readable output.
 * Honors `LOG_PRETTY` override, then TTY detection, then `NO_COLOR`.
 */
function shouldPretty(): boolean {
  if (process.env['NO_COLOR'] !== undefined) return false;
  const override = process.env['LOG_PRETTY'];
  if (override !== undefined) return override !== '0' && override !== 'false';
  return Boolean(process.stdout.isTTY);
}

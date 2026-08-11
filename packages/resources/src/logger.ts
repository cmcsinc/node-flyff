/**
 * Pretty logger for @flyff/resources.
 *
 * Mirrors @flyff/core's format (colored pino-pretty, single-line, dim `[scope]`
 * tag) so loader output matches server output. Duplicated rather than imported
 * from core to keep this package a dependency-light leaf.
 *
 * ponytail: if format drifts between here and core, extract both into a shared
 * `@flyff/log` package and consume from both.
 *
 * @module logger
 */

import pino from 'pino';
import pretty from 'pino-pretty';

export type { Logger } from 'pino';

// ---------------------------------------------------------------------------
// Pretty-root cache
// ---------------------------------------------------------------------------

/** Single shared root so all loaders write through one pretty stream. */
let prettyRoot: pino.Logger | null = null;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a pino logger tagged with `scope` (rendered as a dim `[scope]` prefix
 * on each message line).
 */
export function createResourceLogger(scope: string): pino.Logger {
  if (process.env['NODE_ENV'] === 'test') {
    return pino({ level: 'silent' }).child({ scope });
  }

  const level = resolveLogLevel();

  if (!shouldPretty()) {
    return pino({ level }).child({ scope });
  }

  if (prettyRoot === null) {
    prettyRoot = pino({ level }, prettyStream());
  }

  const child = prettyRoot.child({ scope });
  child.level = level;
  return child;
}

// ---------------------------------------------------------------------------
// Pretty stream
// ---------------------------------------------------------------------------

const LEVEL_COLORS = 'trace:gray,debug:blue,info:green,warn:yellow,error:red,fatal:magentaBright';

/** SGR codes for the dim `[scope]` tag (colorette's `gray`, inlined). */
const GRAY_ON = '\u001b[90m';
const GRAY_OFF = '\u001b[39m';

/**
 * Gray-wraps the `[scope]` tag. Inlined instead of pino-pretty's
 * `extras.colors` (colorette) because this package does not depend on
 * colorette, so its types are unresolved here. `shouldPretty()` already returns
 * false when `NO_COLOR` is set, so the codes never reach a no-color stream.
 */
function gray(text: string): string {
  return `${GRAY_ON}${text}${GRAY_OFF}`;
}

function prettyStream(): ReturnType<typeof pretty> {
  return pretty({
    colorize: true,
    singleLine: true,
    translateTime: 'HH:MM:ss.l',
    ignore: 'pid,hostname',
    customColors: LEVEL_COLORS,
    messageFormat(log, messageKey) {
      const rawMessage = log[messageKey];
      const msg = typeof rawMessage === 'string' ? rawMessage : '';
      const rawTag = log['scope'] ?? log['name'];
      const tag = typeof rawTag === 'string' || typeof rawTag === 'number'
        ? String(rawTag)
        : '';
      if (tag === '') return msg;
      return `${gray(`[${tag}]`)} ${msg}`;
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveLogLevel(): pino.LevelWithSilent {
  const valid: ReadonlySet<string> = new Set([
    'trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent',
  ]);
  const raw = process.env['LOG_LEVEL'] ?? '';
  return valid.has(raw) ? (raw as pino.LevelWithSilent) : 'info';
}

function shouldPretty(): boolean {
  if (process.env['NO_COLOR'] !== undefined) return false;
  const override = process.env['LOG_PRETTY'];
  if (override !== undefined) return override !== '0' && override !== 'false';
  return Boolean(process.stdout.isTTY);
}

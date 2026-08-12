/**
 * Parses one raw server stdout line into displayable parts.
 *
 * The game servers log via pino-pretty (see packages/core/src/logger.ts), so a
 * line looks like:
 *
 *   [01:48:16.766] INFO: [auth-service] Login successful {"accountId":2,...}
 *
 * The supervisor daemon emits its own `[supervisor] ...` lines, and pino writes
 * multi-line error blocks as indented continuations. All three shapes have to
 * survive the same parser — anything unrecognised is passed through as `plain`
 * so no output is ever hidden.
 */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'system' | 'plain';

export interface ParsedLine {
  /** `HH:MM:ss.l` as logged, or `null` for continuations / supervisor lines. */
  time: string | null;
  level: LogLevel;
  /** pino `module`/`service` binding, rendered as a chip. */
  module: string | null;
  message: string;
  /** Trailing structured context, pretty-printed. `null` when absent. */
  detail: string | null;
}

const LEVELS: ReadonlySet<string> = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);

const PINO = /^\[(\d{2}:\d{2}:\d{2}\.\d+)\]\s+([A-Z]+):\s*(?:\[([^\]]+)\]\s*)?([\s\S]*)$/;

/** Splits a trailing JSON object off the message, if the tail really parses. */
function splitDetail(rest: string): { message: string; detail: string | null } {
  const at = rest.indexOf(' {');
  if (at === -1) return { message: rest, detail: null };
  const tail = rest.slice(at + 1);
  try {
    const parsed: unknown = JSON.parse(tail);
    if (parsed === null || typeof parsed !== 'object') return { message: rest, detail: null };
    return { message: rest.slice(0, at), detail: JSON.stringify(parsed, null, 2) };
  } catch {
    return { message: rest, detail: null };
  }
}

export function parseLogLine(line: string): ParsedLine {
  const m = PINO.exec(line);
  if (m) {
    const level = m[2].toLowerCase();
    const { message, detail } = splitDetail(m[4]);
    return {
      time: m[1],
      level: LEVELS.has(level) ? (level as LogLevel) : 'plain',
      // `.at()` (not `m[3]`) because the module group is optional: indexing a
      // RegExpExecArray types as `string`, which hides the undefined it really
      // returns when the line carries no `[module]` binding.
      module: m.at(3) ?? null,
      message,
      detail,
    };
  }
  if (line.startsWith('[supervisor]')) {
    return {
      time: null,
      level: 'system',
      module: 'supervisor',
      message: line.slice('[supervisor]'.length).trim(),
      detail: null,
    };
  }
  return { time: null, level: 'plain', module: null, message: line, detail: null };
}

/** Levels a `plain`/`system` line is grouped with when the user filters. */
export const FILTERABLE: readonly LogLevel[] = ['error', 'warn', 'info', 'debug'];

/**
 * Does `parsed` pass the active level filter? `plain` continuations and
 * `system` lines always pass — hiding an error's stack trace because the stack
 * itself carries no level would be worse than showing a little extra.
 */
export function passesLevel(parsed: ParsedLine, active: ReadonlySet<LogLevel>): boolean {
  if (active.size === 0) return true;
  if (parsed.level === 'plain' || parsed.level === 'system') return true;
  if (parsed.level === 'fatal') return active.has('error');
  if (parsed.level === 'trace') return active.has('debug');
  return active.has(parsed.level);
}

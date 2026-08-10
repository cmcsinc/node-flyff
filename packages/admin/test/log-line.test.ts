import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseLogLine, passesLevel, type LogLevel } from '../lib/log-line';

describe('parseLogLine', () => {
  it('parses a pino-pretty line with module and JSON context', () => {
    const p = parseLogLine(
      '[01:48:16.766] INFO: [auth-service] Authentication successful {"module":"auth-service","accountId":2}',
    );
    assert.equal(p.time, '01:48:16.766');
    assert.equal(p.level, 'info');
    assert.equal(p.module, 'auth-service');
    assert.equal(p.message, 'Authentication successful');
    assert.match(p.detail ?? '', /"accountId": 2/);
  });

  it('parses a line with no module binding', () => {
    const p = parseLogLine('[02:31:40.628] WARN: something happened');
    assert.equal(p.level, 'warn');
    assert.equal(p.module, null);
    assert.equal(p.message, 'something happened');
    assert.equal(p.detail, null);
  });

  it('keeps a brace that is not valid JSON in the message', () => {
    const p = parseLogLine('[02:31:40.628] ERROR: bad {not json');
    assert.equal(p.message, 'bad {not json');
    assert.equal(p.detail, null);
  });

  it('tags supervisor lines as system', () => {
    const p = parseLogLine('[supervisor] exited code=null signal=SIGTERM');
    assert.equal(p.level, 'system');
    assert.equal(p.module, 'supervisor');
    assert.equal(p.message, 'exited code=null signal=SIGTERM');
  });

  it('passes unrecognised lines through as plain', () => {
    const p = parseLogLine('    err: {');
    assert.equal(p.level, 'plain');
    assert.equal(p.message, '    err: {');
    assert.equal(p.time, null);
  });
});

describe('passesLevel', () => {
  const at = (line: string): ParsedLine => parseLogLine(line);
  const set = (...l: LogLevel[]): Set<LogLevel> => new Set(l);

  it('passes everything when no filter is active', () => {
    assert.equal(passesLevel(at('[01:00:00.0] INFO: hi'), new Set()), true);
  });

  it('filters by level', () => {
    assert.equal(passesLevel(at('[01:00:00.0] INFO: hi'), set('error')), false);
    assert.equal(passesLevel(at('[01:00:00.0] ERROR: hi'), set('error')), true);
  });

  it('groups fatal with error and trace with debug', () => {
    assert.equal(passesLevel(at('[01:00:00.0] FATAL: hi'), set('error')), true);
    assert.equal(passesLevel(at('[01:00:00.0] TRACE: hi'), set('debug')), true);
  });

  it('never hides continuations or supervisor lines', () => {
    assert.equal(passesLevel(at('        at TCP.onStreamRead'), set('error')), true);
    assert.equal(passesLevel(at('[supervisor] stopping'), set('debug')), true);
  });
});

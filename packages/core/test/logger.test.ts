/**
 * Tests for packages/core/src/logger.ts
 */

import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { createLogger } from '../src/logger.js';

describe('createLogger', () => {
  it('returns an object with info, warn, error methods', () => {
    const logger = createLogger({ service: 'test' });
    assert.equal(typeof logger.info, 'function');
    assert.equal(typeof logger.warn, 'function');
    assert.equal(typeof logger.error, 'function');
    assert.equal(typeof logger.debug, 'function');
    assert.equal(typeof logger.trace, 'function');
    assert.equal(typeof logger.fatal, 'function');
  });

  it('does not throw when logging at various levels', () => {
    const logger = createLogger({ service: 'test' });
    assert.doesNotThrow(() => logger.info({ action: 'test' }, 'info message'));
    assert.doesNotThrow(() => logger.warn({ action: 'test' }, 'warn message'));
    assert.doesNotThrow(() => logger.error({ action: 'test' }, 'error message'));
    assert.doesNotThrow(() => logger.debug({ action: 'test' }, 'debug message'));
  });

  it('accepts context object as base bindings', () => {
    assert.doesNotThrow(() =>
      createLogger({ service: 'login-server', charId: 42, zone: 'flaris' }),
    );
  });

  it('accepts empty context object', () => {
    assert.doesNotThrow(() => createLogger({}));
  });

  describe('in test environment (NODE_ENV === "test")', () => {
    let original: string | undefined;

    before(() => {
      original = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'test';
    });

    after(() => {
      if (original === undefined) {
        delete process.env['NODE_ENV'];
      } else {
        process.env['NODE_ENV'] = original;
      }
    });

    it('returns a logger with level silent', () => {
      const logger = createLogger({ service: 'test' });
      assert.equal(logger.level, 'silent');
    });
  });

  describe('LOG_LEVEL env override', () => {
    let originalNodeEnv: string | undefined;
    let originalLogLevel: string | undefined;

    before(() => {
      originalNodeEnv = process.env['NODE_ENV'];
      originalLogLevel = process.env['LOG_LEVEL'];
      // Ensure we are not in test mode for this suite
      process.env['NODE_ENV'] = 'development';
    });

    after(() => {
      if (originalNodeEnv === undefined) {
        delete process.env['NODE_ENV'];
      } else {
        process.env['NODE_ENV'] = originalNodeEnv;
      }
      if (originalLogLevel === undefined) {
        delete process.env['LOG_LEVEL'];
      } else {
        process.env['LOG_LEVEL'] = originalLogLevel;
      }
    });

    it('uses LOG_LEVEL=debug when set', () => {
      process.env['LOG_LEVEL'] = 'debug';
      const logger = createLogger({ service: 'test' });
      assert.equal(logger.level, 'debug');
    });

    it('defaults to info when LOG_LEVEL is unset', () => {
      delete process.env['LOG_LEVEL'];
      const logger = createLogger({ service: 'test' });
      assert.equal(logger.level, 'info');
    });

    it('defaults to info when LOG_LEVEL is invalid', () => {
      process.env['LOG_LEVEL'] = 'nonsense';
      const logger = createLogger({ service: 'test' });
      assert.equal(logger.level, 'info');
    });
  });
});

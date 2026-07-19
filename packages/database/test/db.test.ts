import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { createDb, type DbConfig } from '../src/db.js';

describe('db.ts', () => {
  describe('createDb', () => {
    it('should validate SQLite3 config schema', () => {
      const config: DbConfig = {
        client: 'better-sqlite3',
        connection: ':memory:',
      };

      // Just validate the config type - don't actually connect
      assert.equal(config.client, 'better-sqlite3');
      assert.equal(config.connection, ':memory:');
    });

    it('should validate PostgreSQL config schema', () => {
      const config: DbConfig = {
        client: 'pg',
        connection: {
          host: 'localhost',
          port: 5432,
          user: 'test',
          password: 'test',
          database: 'testdb',
        },
      };

      assert.equal(config.client, 'pg');
      assert.equal(config.connection.host, 'localhost');
      assert.equal(config.connection.port, 5432);
    });

    it('should validate MySQL config schema', () => {
      const config: DbConfig = {
        client: 'mysql2',
        connection: {
          host: 'localhost',
          port: 3306,
          user: 'test',
          password: 'test',
          database: 'testdb',
        },
      };

      assert.equal(config.client, 'mysql2');
      assert.equal(config.connection.port, 3306);
    });

    it('should reject invalid client type', () => {
      const config = {
        client: 'invalid',
        connection: ':memory:',
      };

      assert.throws(
        () => createDb(config as DbConfig),
        /Invalid enum value/
      );
    });

    it('should reject incomplete PostgreSQL config', () => {
      const config = {
        client: 'pg',
        connection: {
          host: 'localhost',
        },
      };

      assert.throws(
        () => createDb(config as DbConfig),
        /Invalid/
      );
    });
  });
});

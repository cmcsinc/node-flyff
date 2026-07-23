import { describe, it, before } from 'node:test';
import * as assert from 'node:assert/strict';
import { TokenService } from '../../src/services/token.service';
import type { ICacheAdapter } from '@flyff/core/cache';

// Mock cache
function makeMockCache(): ICacheAdapter & { store: Map<string, { value: string; expiresAt: number }> } {
  const store = new Map<string, { value: string; expiresAt: number }>();

  return {
    store,
    get: async (key: string) => {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt < Date.now()) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    set: async (key: string, value: string, ttlSeconds?: number) => {
      const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : Infinity;
      store.set(key, { value, expiresAt });
    },
    del: async (key: string) => {
      store.delete(key);
    },
  };
}

describe('TokenService', () => {
  let tokenService: TokenService;
  let mockCache: ICacheAdapter;
  const ipcSecret = 'test-ipc-secret';

  before(() => {
    mockCache = makeMockCache();
    tokenService = new TokenService(mockCache, ipcSecret);
  });

  describe('generateHandoffToken', () => {
    it('should generate a valid token', async () => {
      const accountId = 123;
      const token = await tokenService.generateHandoffToken(accountId);

      assert.ok(token);
      assert.ok(token.includes(':')); // Should contain colons

      const parts = token.split(':');
      assert.equal(parts.length, 4); // accountId:timestamp:random:signature
    });

    it('should store token in cache', async () => {
      const accountId = 456;
      const token = await tokenService.generateHandoffToken(accountId);

      const cacheKey = `handoff:${token}`;
      const cached = await mockCache.get(cacheKey);

      assert.ok(cached);
      assert.equal(cached, String(accountId));
    });

    it('should generate different tokens for same account', async () => {
      const accountId = 789;
      const token1 = await tokenService.generateHandoffToken(accountId);
      const token2 = await tokenService.generateHandoffToken(accountId);

      assert.notEqual(token1, token2);
    });
  });

  describe('validateHandoffToken', () => {
    it('should validate correct token', async () => {
      const accountId = 100;
      const token = await tokenService.generateHandoffToken(accountId);

      const result = await tokenService.validateHandoffToken(token);

      assert.equal(result.valid, true);
      assert.equal(result.accountId, accountId);
    });

    it('should reject invalid format', async () => {
      const result = await tokenService.validateHandoffToken('invalid');

      assert.equal(result.valid, false);
      assert.equal(result.accountId, 0);
    });

    it('should reject invalid signature', async () => {
      const accountId = 200;
      const token = await tokenService.generateHandoffToken(accountId);

      // Tamper with the token
      const parts = token.split(':');
      const tamperedToken = `${parts[0]}:${parts[1]}:${parts[2]}:badsignature`;

      const result = await tokenService.validateHandoffToken(tamperedToken);

      assert.equal(result.valid, false);
      assert.equal(result.accountId, 0);
    });

    it('should reject expired token', async () => {
      const accountId = 300;
      const token = await tokenService.generateHandoffToken(accountId);

      // Manually expire the token
      const cache = mockCache as any;
      const entry = cache.store.get(`handoff:${token}`);
      if (entry) entry.expiresAt = Date.now() - 1000;

      const result = await tokenService.validateHandoffToken(token);

      assert.equal(result.valid, false);
      assert.equal(result.accountId, 0);
    });

    it('should reject unknown token', async () => {
      const token = '300:1234567890abcdef:0123456789abcdef:signature';
      const result = await tokenService.validateHandoffToken(token);

      assert.equal(result.valid, false);
      assert.equal(result.accountId, 0);
    });

    it('should delete token after validation (single-use)', async () => {
      const accountId = 400;
      const token = await tokenService.generateHandoffToken(accountId);

      // First validation should succeed
      const result1 = await tokenService.validateHandoffToken(token);
      assert.equal(result1.valid, true);

      // Second validation should fail (single-use)
      const result2 = await tokenService.validateHandoffToken(token);
      assert.equal(result2.valid, false);
    });
  });

  describe('generateSessionToken', () => {
    it('should generate a valid token', async () => {
      const accountId = 500;
      const clientIp = '127.0.0.1';
      const token = await tokenService.generateSessionToken(accountId, clientIp);

      assert.ok(token);
      assert.ok(token.includes(':'));

      const parts = token.split(':');
      assert.equal(parts.length, 5); // accountId:ip:timestamp:random:signature
      assert.equal(parts[0], String(accountId));
      assert.equal(parts[1], clientIp);
    });

    it('should include IP in token', async () => {
      const accountId = 600;
      const clientIp = '192.168.1.100';
      const token = await tokenService.generateSessionToken(accountId, clientIp);

      const parts = token.split(':');
      assert.equal(parts[1], clientIp);
    });

    it('should generate different tokens for same account', async () => {
      const accountId = 700;
      const clientIp = '127.0.0.1';
      const token1 = await tokenService.generateSessionToken(accountId, clientIp);
      const token2 = await tokenService.generateSessionToken(accountId, clientIp);

      assert.notEqual(token1, token2);
    });
  });

  describe('validateSessionToken', () => {
    it('should validate correct token', async () => {
      const accountId = 800;
      const clientIp = '127.0.0.1';
      const token = await tokenService.generateSessionToken(accountId, clientIp);

      const result = await tokenService.validateSessionToken(token, clientIp);

      assert.equal(result, accountId);
    });

    it('should reject invalid format', async () => {
      const result = await tokenService.validateSessionToken('invalid', '127.0.0.1');
      assert.equal(result, 0);
    });

    it('should reject invalid signature', async () => {
      const accountId = 900;
      const clientIp = '127.0.0.1';
      const token = await tokenService.generateSessionToken(accountId, clientIp);

      // Tamper with the token
      const parts = token.split(':');
      const tamperedToken = `${parts[0]}:${parts[1]}:${parts[2]}:${parts[3]}:badsignature`;

      const result = await tokenService.validateSessionToken(tamperedToken, clientIp);
      assert.equal(result, 0);
    });

    it('should reject mismatched IP', async () => {
      const accountId = 1000;
      const clientIp = '127.0.0.1';
      const token = await tokenService.generateSessionToken(accountId, clientIp);

      const result = await tokenService.validateSessionToken(token, '192.168.1.1');
      assert.equal(result, 0);
    });

    it('should reject expired token', async () => {
      const accountId = 1100;
      const clientIp = '127.0.0.1';

      // Generate a token with an old timestamp
      const timestamp = Date.now() - 2_000_000; // 33 minutes ago (over 30 min TTL)
      const random = Math.random().toString(16).substring(2);
      const raw = `${accountId}:${clientIp}:${timestamp}:${random}`;

      // Sign it
      const crypto = await import('node:crypto');
      const signature = crypto.createHmac('sha256', ipcSecret).update(raw).digest('hex');
      const token = `${raw}:${signature}`;

      const result = await tokenService.validateSessionToken(token, clientIp);
      assert.equal(result, 0);
    });
  });
});

import { describe, it, mock, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { AuthService } from '../../src/services/auth.service';
import type { AccountRepository } from '@flyff/database/repositories/account.repo';
import type { ICacheAdapter } from '@flyff/core/cache';
import type { AccountRow } from '@flyff/database/repositories/account.repo';

// Mock dependencies
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

function makeMockAccountRepo(): AccountRepository & { accounts: Map<number, AccountRow> } {
  const accounts = new Map<number, AccountRow>();

  return {
    accounts,
    findById: async (id: number) => accounts.get(id) || null,
    findByUsername: async (username: string) => {
      for (const account of accounts.values()) {
        if (account.username === username) return account;
      }
      return null;
    },
    findByEmail: async () => null,
    create: async () => 1,
    updatePassword: async () => {},
    update: async () => {},
    setBanStatus: async (id: number, banned: boolean, bannedUntil?: Date) => {
      const account = accounts.get(id);
      if (account) {
        account.banned = banned;
        account.banned_until = bannedUntil || null;
      }
    },
    delete: async () => {},
    usernameExists: async () => false,
    emailExists: async () => false,
  };
}

describe('AuthService', () => {
  let authService: AuthService;
  let mockCache: ICacheAdapter;
  let mockRepo: AccountRepository;
  let testAccountId: number;

  before(() => {
    mockCache = makeMockCache();
    mockRepo = makeMockAccountRepo();
    authService = new AuthService(mockCache, mockRepo);

    // Create a test account with a known password hash
    testAccountId = 1;
    const testAccount: AccountRow = {
      id: testAccountId,
      username: 'testuser',
      password_hash: '$argon2id$v=19$m=65536,t=3,p=4$test$test', // Placeholder, will be replaced in tests
      email: 'test@example.com',
      gm: false,
      banned: false,
      banned_until: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    mockRepo.accounts.set(testAccountId, testAccount);
  });

  describe('hashPassword', () => {
    it('should hash a password', async () => {
      const password = 'testPassword123';
      const hash = await authService.hashPassword(password);

      assert.ok(hash);
      assert.notEqual(hash, password);
      // argon2id when the native binding is available, else the documented
      // scrypt fallback (see core/utils/password.ts) -- both are valid.
      assert.ok(
        hash.startsWith('$argon2id$') || hash.startsWith('$scrypt$'),
        `unexpected hash format: ${hash}`,
      );
    });

    it('should generate different hashes for the same password', async () => {
      const password = 'testPassword123';
      const hash1 = await authService.hashPassword(password);
      const hash2 = await authService.hashPassword(password);

      assert.notEqual(hash1, hash2); // Different salts
    });
  });

  describe('verifyPassword', () => {
    it('should verify correct password', async () => {
      const password = 'testPassword123';
      const hash = await authService.hashPassword(password);

      const valid = await authService.verifyPassword(password, hash);
      assert.equal(valid, true);
    });

    it('should reject incorrect password', async () => {
      const hash = await authService.hashPassword('correctPassword');

      const valid = await authService.verifyPassword('wrongPassword', hash);
      assert.equal(valid, false);
    });

    it('should handle invalid hash gracefully', async () => {
      const valid = await authService.verifyPassword('password', 'invalid_hash');
      assert.equal(valid, false);
    });
  });

  describe('validateCredentials', () => {
    it('should validate correct credentials', async () => {
      const password = 'testPassword123';
      const hash = await authService.hashPassword(password);

      const account = mockRepo.accounts.get(1)!;
      mockRepo.accounts.set(1, {
        ...account,
        password_hash: hash,
      });

      const result = await authService.validateCredentials('testuser', password);

      assert.equal(result.valid, true);
      assert.equal(result.accountId, testAccountId);
      assert.equal(result.banned, false);
    });

    it('should reject invalid username', async () => {
      const result = await authService.validateCredentials('nonexistent', 'password');

      assert.equal(result.valid, false);
      assert.equal(result.accountId, 0);
    });

    it('should reject invalid password', async () => {
      const password = 'testPassword123';
      const hash = await authService.hashPassword(password);

      const account = mockRepo.accounts.get(1)!;
      mockRepo.accounts.set(1, {
        ...account,
        password_hash: hash,
      });

      const result = await authService.validateCredentials('testuser', 'wrongPassword');

      assert.equal(result.valid, false);
      assert.equal(result.accountId, testAccountId);
      assert.equal(result.banned, false);
    });

    it('should reject banned account', async () => {
      const password = 'testPassword123';
      const hash = await authService.hashPassword(password);

      const account = mockRepo.accounts.get(1)!;
      mockRepo.accounts.set(1, {
        ...account,
        password_hash: hash,
        banned: true,
        banned_until: null,
      });

      const result = await authService.validateCredentials('testuser', password);

      assert.equal(result.valid, false);
      assert.equal(result.accountId, 0);
      assert.equal(result.banned, true);
    });

    it('should allow account with expired ban', async () => {
      const password = 'testPassword123';
      const hash = await authService.hashPassword(password);

      const account = mockRepo.accounts.get(1)!;
      mockRepo.accounts.set(1, {
        ...account,
        password_hash: hash,
        banned: true,
        banned_until: new Date(Date.now() - 10000), // Expired 10 seconds ago
      });

      const result = await authService.validateCredentials('testuser', password);

      assert.equal(result.valid, true);
      assert.equal(result.accountId, testAccountId);
      assert.equal(result.banned, false);
    });
  });

  describe('createSession and validateSession', () => {
    it('should create and validate session', async () => {
      const token = await authService.createSession(testAccountId, '127.0.0.1');

      assert.ok(token);
      assert.equal(token.length, 64); // 32 bytes = 64 hex chars

      const session = await authService.validateSession(token);
      assert.ok(session);
      assert.equal(session!.accountId, testAccountId);
      assert.equal(session!.clientIp, '127.0.0.1');
    });

    it('should return null for invalid token', async () => {
      const session = await authService.validateSession('invalidtoken');
      assert.equal(session, null);
    });

    it('should expire session after TTL', async () => {
      const token = await authService.createSession(testAccountId, '127.0.0.1');

      // Manually expire the session
      const cache = mockCache as any;
      const entry = cache.store.get(`session:${token}`);
      if (entry) entry.expiresAt = Date.now() - 1000;

      const session = await authService.validateSession(token);
      assert.equal(session, null);
    });
  });

  describe('invalidateSession', () => {
    it('should invalidate session', async () => {
      const token = await authService.createSession(testAccountId, '127.0.0.1');

      await authService.invalidateSession(token);

      const session = await authService.validateSession(token);
      assert.equal(session, null);
    });
  });

  describe('checkRateLimit', () => {
    it('should allow requests under limit', async () => {
      for (let i = 0; i < 5; i++) {
        const allowed = await authService.checkRateLimit('127.0.0.1');
        assert.equal(allowed, true);
      }
    });

    it('should block requests over limit', async () => {
      for (let i = 0; i < 5; i++) {
        await authService.checkRateLimit('192.168.1.1');
      }

      const allowed = await authService.checkRateLimit('192.168.1.1');
      assert.equal(allowed, false);
    });

    it('should reset after TTL', async () => {
      for (let i = 0; i < 5; i++) {
        await authService.checkRateLimit('10.0.0.1');
      }

      // Manually expire the rate limit entry
      const cache = mockCache as any;
      const entry = cache.store.get('ratelimit:login:10.0.0.1');
      if (entry) entry.expiresAt = Date.now() - 1000;

      const allowed = await authService.checkRateLimit('10.0.0.1');
      assert.equal(allowed, true);
    });
  });

  describe('clearRateLimit', () => {
    it('should clear rate limit counter', async () => {
      for (let i = 0; i < 5; i++) {
        await authService.checkRateLimit('172.16.0.1');
      }

      await authService.clearRateLimit('172.16.0.1');

      const allowed = await authService.checkRateLimit('172.16.0.1');
      assert.equal(allowed, true);
    });
  });
});

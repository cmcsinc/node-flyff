import crypto from 'node:crypto';
import { hashPassword, verifyPassword } from '@flyff/core/utils/password';
import type { ICacheAdapter } from '@flyff/core/cache';
import type { AccountRepository } from '@flyff/database/repositories/account.repo';
import { createLogger } from '@flyff/core/logger';

const logger = createLogger({ module: 'auth-service' });

/**
 * Result of credential validation.
 */
export interface CredentialResult {
  accountId: number;
  valid: boolean;
  banned?: boolean;
  bannedUntil?: Date | null;
}

/**
 * Session data stored in cache.
 */
export interface SessionData {
  accountId: number;
  clientIp: string;
  createdAt: number;
}

/**
 * Authentication service.
 *
 * Handles password hashing, credential validation, session management,
 * and rate limiting using ICacheAdapter.
 */
export class AuthService {
  constructor(
    private cache: ICacheAdapter,
    private accountRepo: AccountRepository
  ) {}

  /**
   * Hash a password using argon2id.
   *
   * @param password - Plain text password
   * @returns Password hash
   */
  async hashPassword(password: string): Promise<string> {
    return hashPassword(password);
  }

  /**
   * Verify a password against a hash.
   *
   * @param password - Plain text password
   * @param hash - Stored password hash
   * @returns True if password matches
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return verifyPassword(password, hash);
  }

  /**
   * Validate user credentials.
   *
   * @param username - Username
   * @param password - Plain text password
   * @returns Validation result with account ID
   */
  async validateCredentials(
    username: string,
    password: string
  ): Promise<CredentialResult> {
    const account = await this.accountRepo.findByUsername(username);

    if (!account) {
      logger.info({ username }, 'Authentication failed: account not found');
      return { accountId: 0, valid: false };
    }

    // Check if account is banned
    if (account.banned) {
      const isPermaban = account.banned_until === null;
      const isExpired = account.banned_until && account.banned_until < new Date();

      if (isPermaban || !isExpired) {
        logger.warn(
          {
            accountId: account.id,
            username,
            bannedUntil: account.banned_until,
          },
          'Authentication failed: account is banned'
        );
        return {
          accountId: 0,
          valid: false,
          banned: true,
          bannedUntil: account.banned_until,
        };
      }

      // Ban expired - unban the account
      await this.accountRepo.setBanStatus(account.id, false);
    }

    const valid = await this.verifyPassword(password, account.password_hash);

    if (valid) {
      logger.info({ accountId: account.id, username }, 'Authentication successful');
    } else {
      logger.warn({ accountId: account.id, username }, 'Authentication failed: invalid password');
    }

    return {
      accountId: account.id,
      valid,
      banned: false,
    };
  }

  /**
   * Create a session token.
   *
   * @param accountId - Account ID
   * @param clientIp - Client IP address
   * @returns Session token (64 hex characters)
   */
  async createSession(accountId: number, clientIp: string): Promise<string> {
    const token = crypto.randomBytes(32).toString('hex');
    const data: SessionData = {
      accountId,
      clientIp,
      createdAt: Date.now(),
    };

    await this.cache.set(`session:${token}`, JSON.stringify(data), 1800); // 30 minutes

    logger.debug({ accountId, clientIp }, 'Session created');

    return token;
  }

  /**
   * Validate a session token.
   *
   * @param token - Session token
   * @returns Session data or null if invalid
   */
  async validateSession(token: string): Promise<SessionData | null> {
    const data = await this.cache.get(`session:${token}`);

    if (!data) {
      return null;
    }

    try {
      const session = JSON.parse(data) as SessionData;
      return session;
    } catch {
      logger.warn({ token }, 'Failed to parse session data');
      return null;
    }
  }

  /**
   * Invalidate a session token.
   *
   * @param token - Session token to invalidate
   */
  async invalidateSession(token: string): Promise<void> {
    await this.cache.del(`session:${token}`);
    logger.debug({ token }, 'Session invalidated');
  }

  /**
   * Check rate limit for login attempts from an IP.
   *
   * @param ip - Client IP address
   * @returns True if under rate limit, false if exceeded
   */
  async checkRateLimit(ip: string): Promise<boolean> {
    const key = `ratelimit:login:${ip}`;
    const current = await this.cache.get(key);
    const attempts = current ? parseInt(current, 10) : 0;

    if (attempts >= 5) {
      logger.warn({ ip, attempts }, 'Rate limit exceeded');
      return false;
    }

    await this.cache.set(key, String(attempts + 1), 60); // 1 minute window

    return true;
  }

  /**
   * Clear rate limit counter for an IP.
   *
   * Called after successful authentication.
   *
   * @param ip - Client IP address
   */
  async clearRateLimit(ip: string): Promise<void> {
    const key = `ratelimit:login:${ip}`;
    await this.cache.del(key);
  }
}

import crypto from 'node:crypto';
import { createHmac } from 'node:crypto';
import type { ICacheAdapter } from '@flyff/core/cache';
import { createLogger } from '@flyff/core/logger';

const logger = createLogger({ module: 'token-service' });

/**
 * Result of handoff token validation.
 */
export interface HandoffResult {
  accountId: number;
  valid: boolean;
}

/**
 * Handoff token service.
 *
 * Generates and validates signed tokens for secure player handoff
 * between Login Server and Cluster Server.
 */
export class TokenService {
  constructor(
    private cache: ICacheAdapter,
    private ipcSecret: string
  ) {}

  /**
   * Sign data with HMAC-SHA256.
   *
   * @param data - Data to sign
   * @returns Hex-encoded signature
   */
  private sign(data: string): string {
    return createHmac('sha256', this.ipcSecret).update(data).digest('hex');
  }

  /**
   * Generate a handoff token for cluster server connection.
   *
   * Token format: {accountId}:{timestamp}:{random}:{signature}
   *
   * @param accountId - Account ID
   * @returns Handoff token
   */
  async generateHandoffToken(accountId: number): Promise<string> {
    const timestamp = Date.now();
    const random = crypto.randomBytes(16).toString('hex');
    const raw = `${accountId}:${timestamp}:${random}`;
    const signature = this.sign(raw);

    const token = `${raw}:${signature}`;

    // Store in cache for 5 minutes (single-use)
    await this.cache.set(`handoff:${token}`, String(accountId), 300);

    logger.debug({ accountId }, 'Handoff token generated');

    return token;
  }

  /**
   * Validate a handoff token.
   *
   * @param token - Handoff token to validate
   * @returns Validation result with account ID
   */
  async validateHandoffToken(token: string): Promise<HandoffResult> {
    // Token format: accountId:timestamp:random:signature
    const parts = token.split(':');

    if (parts.length !== 4) {
      logger.warn({ token }, 'Invalid handoff token format');
      return { accountId: 0, valid: false };
    }

    const [accountIdStr, timestampStr, random, signature] = parts;

    // Validate all parts are defined
    if (!accountIdStr || !timestampStr || !random || !signature) {
      logger.warn({ token }, 'Invalid handoff token format (missing parts)');
      return { accountId: 0, valid: false };
    }

    const raw = `${accountIdStr}:${timestampStr}:${random}`;

    // Verify signature
    const expectedSignature = this.sign(raw);
    if (signature !== expectedSignature) {
      logger.warn({ token }, 'Invalid handoff token signature');
      return { accountId: 0, valid: false };
    }

    // Verify token hasn't expired (5 minutes)
    const timestamp = parseInt(timestampStr, 10);
    const age = Date.now() - timestamp;
    if (age > 300_000) {
      logger.warn({ token, age }, 'Handoff token expired');
      return { accountId: 0, valid: false };
    }

    // Verify token exists in cache (not already used)
    const accountIdStrFromCache = await this.cache.get(`handoff:${token}`);
    if (!accountIdStrFromCache) {
      logger.warn({ token }, 'Handoff token not found or already used');
      return { accountId: 0, valid: false };
    }

    // Single-use - delete after validation
    await this.cache.del(`handoff:${token}`);

    const accountId = parseInt(accountIdStrFromCache, 10);

    logger.debug({ accountId }, 'Handoff token validated');

    return { accountId, valid: true };
  }

  /**
   * Generate a session token for web/client use.
   *
   * @param accountId - Account ID
   * @param clientIp - Client IP address
   * @returns Session token (64 hex characters)
   */
  async generateSessionToken(accountId: number, clientIp: string): Promise<string> {
    const raw = `${accountId}:${clientIp}:${Date.now()}:${crypto.randomBytes(16).toString('hex')}`;
    const signature = this.sign(raw);
    const token = `${raw}:${signature}`;

    logger.debug({ accountId, clientIp }, 'Session token generated');

    return token;
  }

  /**
   * Validate a session token.
   *
   * @param token - Session token
   * @param clientIp - Client IP address for validation
   * @returns Account ID if valid, 0 if invalid
   */
  async validateSessionToken(token: string, clientIp: string): Promise<number> {
    const parts = token.split(':');

    if (parts.length !== 5) {
      logger.warn({ token }, 'Invalid session token format');
      return 0;
    }

    const [accountIdStr, ipStr, timestampStr, random, signature] = parts;

    // Validate all parts are defined
    if (!accountIdStr || !ipStr || !timestampStr || !random || !signature) {
      logger.warn({ token }, 'Invalid session token format (missing parts)');
      return 0;
    }

    const raw = `${accountIdStr}:${ipStr}:${timestampStr}:${random}`;

    // Verify signature
    const expectedSignature = this.sign(raw);
    if (signature !== expectedSignature) {
      logger.warn({ token }, 'Invalid session token signature');
      return 0;
    }

    // Verify IP matches
    if (ipStr !== clientIp) {
      logger.warn({ token, expectedIp: ipStr, actualIp: clientIp }, 'Session token IP mismatch');
      return 0;
    }

    // Verify token hasn't expired (30 minutes)
    const timestamp = parseInt(timestampStr, 10);
    const age = Date.now() - timestamp;
    if (age > 1_800_000) {
      logger.warn({ token, age }, 'Session token expired');
      return 0;
    }

    const accountId = parseInt(accountIdStr, 10);

    logger.debug({ accountId, clientIp }, 'Session token validated');

    return accountId;
  }
}

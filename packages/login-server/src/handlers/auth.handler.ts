import type { Socket } from 'node:net';
import { SNSP } from '@flyff/core/constants/opcodes.js';
import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { PacketError, AuthError } from '@flyff/core/errors.js';
import type { AuthService } from '../services/auth.service.js';
import type { TokenService } from '../services/token.service.js';
import type { EventBus } from '@flyff/core/eventBus.js';
import { createLogger } from '@flyff/core/logger.js';

type LoginEvents = {
  'login:success': [{ accountId: number; socket: unknown; handoffToken: string }];
};

const logger = createLogger({ module: 'auth-handler' });

/**
 * Login certification result.
 */
interface CertifyResult {
  success: boolean;
  errorCode?: number;
  handoffToken?: string;
  accountId?: number;
}

/**
 * Login authentication handler.
 *
 * Handles SNSP_LOGIN_CERTIFY packet from client.
 */
export class AuthHandler {
  constructor(
    private authService: AuthService,
    private tokenService: TokenService,
    private bus: EventBus<LoginEvents>
  ) {}

  /**
   * Handle LOGIN_CERTIFY packet.
   *
   * Packet structure:
   * - key: DWORD (encryption key, unused initially)
   * - username: string (DWORD-length-prefixed)
   * - password: string (DWORD-length-prefixed, MD5 hash)
   * - version: DWORD (client version)
   *
   * @param socket - Client socket
   * @param reader - Packet reader
   */
  async handleCertify(socket: Socket, reader: PacketReader): Promise<void> {
    try {
      // Read packet fields
      const key = reader.readDword();
      const username = reader.readString();
      const password = reader.readString();
      const version = reader.readDword();

      // Validate input
      this.validateCertifyInput(username, password, version);

      // Get client IP
      const ip = socket.remoteAddress ?? 'unknown';

      // Check rate limit
      const rateLimitOk = await this.authService.checkRateLimit(ip);
      if (!rateLimitOk) {
        this.sendError(socket, 2); // Error code 2: rate limit exceeded
        logger.warn({ ip }, 'Login rate limit exceeded');
        return;
      }

      // Validate credentials
      const result = await this.authService.validateCredentials(username, password);

      if (!result.valid) {
        if (result.banned) {
          this.sendError(socket, 6); // Error code 6: account banned
          logger.warn({ username, ip }, 'Login failed: account banned');
        } else {
          this.sendError(socket, 0); // Error code 0: invalid credentials
          logger.info({ username, ip }, 'Login failed: invalid credentials');
        }
        return;
      }

      // Clear rate limit on successful auth
      await this.authService.clearRateLimit(ip);

      // Create session
      await this.authService.createSession(result.accountId, ip);

      // Generate handoff token for cluster server
      const handoffToken = await this.tokenService.generateHandoffToken(result.accountId);

      // Emit event for server list
      this.bus.emit('login:success', {
        accountId: result.accountId,
        socket,
        handoffToken,
      });

      logger.info({ accountId: result.accountId, username, ip }, 'Login successful');
    } catch (error) {
      if (error instanceof PacketError || error instanceof AuthError) {
        logger.error({ error }, 'Login failed: packet/auth error');
        this.sendError(socket, 0);
      } else {
        logger.error({ error }, 'Login failed: unexpected error');
        this.sendError(socket, 0);
      }
    }
  }

  /**
   * Validate LOGIN_CERTIFY input fields.
   *
   * @param username - Username
   * @param password - Password
   * @param version - Client version
   * @throws PacketError if validation fails
   */
  private validateCertifyInput(
    username: string,
    password: string,
    version: number
  ): void {
    // Username: 3-16 alphanumeric characters
    if (username.length < 3 || username.length > 16) {
      throw new PacketError('Invalid username length');
    }

    const usernameRegex = /^[a-zA-Z0-9_]+$/;
    if (!usernameRegex.test(username)) {
      throw new PacketError('Invalid username format');
    }

    // Password: MD5 hash is 32 characters
    if (password.length !== 32) {
      throw new PacketError('Invalid password length');
    }

    const passwordRegex = /^[a-fA-F0-9]{32}$/;
    if (!passwordRegex.test(password)) {
      throw new PacketError('Invalid password format');
    }

    // Version: must be a reasonable value
    if (version < 1000 || version > 99999) {
      throw new PacketError('Invalid client version');
    }
  }

  /**
   * Send error response to client.
   *
   * @param socket - Client socket
   * @param errorCode - Error code (0 = invalid credentials, 2 = rate limit, 6 = banned)
   */
  private sendError(socket: Socket, errorCode: number): void {
    const writer = new PacketWriter();
    writer.writeWord(0x5E80); // Header
    writer.writeWord(SNSP.ERROR_CODE);
    writer.writeDword(errorCode);

    const packet = writer.build();
    socket.write(packet);
  }
}

import type { Socket } from 'node:net';
import { PACKETTYPE } from '@flyff/core/constants/opcodes.js';
import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { sendPacket } from '@flyff/core/net/dispatcher.js';
import { PacketError, AuthError } from '@flyff/core/errors.js';
import type { AuthService } from '../services/auth.service.js';
import type { TokenService } from '../services/token.service.js';
import type { EventBus } from '@flyff/core/eventBus.js';
import { createLogger } from '@flyff/core/logger.js';
import { decryptV15Password, V15_PASSWORD_BLOB_SIZE } from '../utils/v15Password.js';

type LoginEvents = {
  'login:success': [{ accountId: number; socket: unknown; handoffToken: string }];
};

const logger = createLogger({ module: 'auth-handler' });

/** Default v15 protocol version (`NEUZ_MSGVR`, `_Common/LodeConfig.h:9`). */
const DEFAULT_PROTOCOL_VERSION = '20100412';

/**
 * Login certification handler — `PACKETTYPE_CERTIFY` (0xfc).
 *
 * v15 client→certifier payload (after opcode, `Neuz/DPCertified.cpp:122-165`):
 *   [string protocolVersion][string account][672-byte Rijndael-CBC password blob]
 * The blob decrypts to the 32-char `md5("kikugalanet"+pwd)` lowercase hex; the
 * service argon2-verifies that digest against the stored hash.
 */
export class AuthHandler {
  private readonly expectedProtocolVersion: string;

  constructor(
    private authService: AuthService,
    private tokenService: TokenService,
    private bus: EventBus<LoginEvents>,
    opts: { expectedProtocolVersion?: string } = {},
  ) {
    this.expectedProtocolVersion = opts.expectedProtocolVersion ?? DEFAULT_PROTOCOL_VERSION;
  }

  async handleCertify(socket: Socket, reader: PacketReader): Promise<void> {
    try {
      const protocolVersion = reader.readString();
      const account = reader.readString();
      const blob = reader.readBytes(V15_PASSWORD_BLOB_SIZE);
      const md5hex = decryptV15Password(blob);

      this.validateCertifyInput(account, md5hex, protocolVersion);

      const ip = socket.remoteAddress ?? 'unknown';

      const rateLimitOk = await this.authService.checkRateLimit(ip);
      if (!rateLimitOk) {
        this.sendError(socket, 2); // rate limit exceeded
        logger.warn({ ip }, 'Login rate limit exceeded');
        return;
      }

      const result = await this.authService.validateCredentials(account, md5hex);

      if (!result.valid) {
        if (result.banned) {
          this.sendError(socket, 6); // account banned
          logger.warn({ account, ip }, 'Login failed: account banned');
        } else {
          this.sendError(socket, 0); // invalid credentials
          logger.info({ account, ip }, 'Login failed: invalid credentials');
        }
        return;
      }

      await this.authService.clearRateLimit(ip);
      await this.authService.createSession(result.accountId, ip);
      const handoffToken = await this.tokenService.generateHandoffToken(result.accountId);

      this.bus.emit('login:success', {
        accountId: result.accountId,
        socket,
        handoffToken,
      });

      logger.info({ accountId: result.accountId, account, ip }, 'Login successful');
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

  private validateCertifyInput(account: string, md5hex: string, protocolVersion: string): void {
    if (protocolVersion !== this.expectedProtocolVersion) {
      throw new PacketError(`Illegal protocol version: ${protocolVersion}`);
    }
    if (account.length < 1 || account.length > 42) {
      throw new PacketError('Invalid account length');
    }
    if (!/^[a-zA-Z0-9_]+$/.test(account)) {
      throw new PacketError('Invalid account format');
    }
    if (md5hex.length !== 32) {
      throw new PacketError('Decrypted password is not a 32-char md5 hex');
    }
  }

  private sendError(socket: Socket, errorCode: number): void {
    const writer = new PacketWriter();
    writer.writeDword(PACKETTYPE.ERROR);
    writer.writeDword(errorCode);
    sendPacket(socket, writer.build());
  }
}

import type { Socket } from 'node:net';
import { PACKETTYPE, LOGIN_ERROR } from '@flyff/core/constants/opcodes';
import { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { sendPacket } from '@flyff/core/net/dispatcher';
import { PacketError, AuthError } from '@flyff/core/errors';
import type { AuthService } from '../services/auth.service';
import type { TokenService } from '../services/token.service';
import type { EventBus } from '@flyff/core/eventBus';
import { createLogger } from '@flyff/core/logger';
import { decryptV15Password, V15_PASSWORD_BLOB_SIZE } from '../utils/v15Password';

type LoginEvents = {
  'login:success': [{ accountId: number; account: string; socket: unknown; handoffToken: string }];
};

const logger = createLogger({ module: 'auth-handler' });

/** Default v15 protocol version (`NEUZ_MSGVR`, `_Common/LodeConfig.h:9`). */
const DEFAULT_PROTOCOL_VERSION = '20100412';

/**
 * Login certification handler -- `PACKETTYPE_CERTIFY` (0xfc).
 *
 * v15 client->certifier payload (after opcode, `Neuz/DPCertified.cpp:122-165`):
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

      // debug-only: what the real client sent (protocol version, decrypted md5,
      // blob head). Useful when diagnosing live login failures.
      logger.debug(
        { protocolVersion, account, decryptedLen: md5hex.length, blobHead: blob.subarray(0, 16).toString('hex') },
        'CERTIFY received',
      );

      this.validateCertifyInput(account, md5hex, protocolVersion);

      const ip = socket.remoteAddress ?? 'unknown';

      const rateLimitOk = await this.authService.checkRateLimit(ip);
      if (!rateLimitOk) {
        this.sendError(socket, LOGIN_ERROR.THROTTLE_15SEC);
        logger.warn({ ip }, 'Login rate limit exceeded');
        return;
      }

      const result = await this.authService.validateCredentials(account, md5hex);

      if (!result.valid) {
        if (result.banned) {
          this.sendError(socket, LOGIN_ERROR.BLOCKED);
          logger.warn({ account, ip }, 'Login failed: account banned');
        } else {
          this.sendError(socket, LOGIN_ERROR.WRONG_PASSWORD);
          logger.info({ account, ip }, 'Login failed: invalid credentials');
        }
        return;
      }

      await this.authService.clearRateLimit(ip);
      await this.authService.createSession(result.accountId, ip);
      const handoffToken = await this.tokenService.generateHandoffToken(result.accountId);

      this.bus.emit('login:success', {
        accountId: result.accountId,
        account,
        socket,
        handoffToken,
      });

      logger.info({ accountId: result.accountId, account, ip }, 'Login successful');
    } catch (error) {
      if (error instanceof PacketError || error instanceof AuthError) {
        logger.error({ error }, 'Login failed: packet/auth error');
        this.sendError(socket, LOGIN_ERROR.WRONG_PASSWORD);
      } else {
        logger.error({ error }, 'Login failed: unexpected error');
        this.sendError(socket, LOGIN_ERROR.CERT_GENERAL);
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

  /** Send a v15 `PACKETTYPE_ERROR` (0xfe) reply: `[opcode][LONG errorCode]`. */
  private sendError(socket: Socket, errorCode: number): void {
    const writer = new PacketWriter();
    writer.writeDword(PACKETTYPE.ERROR);
    writer.writeDword(errorCode);
    sendPacket(socket, writer.build());
  }
}

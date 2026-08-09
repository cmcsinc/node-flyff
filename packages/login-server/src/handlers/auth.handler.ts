import type { Socket } from 'node:net';
import { PACKETTYPE, LOGIN_ERROR } from '@flyff/core/constants/opcodes';
import type { PacketReader } from '@flyff/core/net/PacketReader';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { sendPacket } from '@flyff/core/net/dispatcher';
import { PacketError, AuthError } from '@flyff/core/errors';
import type { AuthService } from '../services/auth.service';
import type { TokenService } from '../services/token.service';
import type { EventBus } from '@flyff/core/eventBus';
import { createLogger } from '@flyff/core/logger';
import { decryptV15Password, V15_PASSWORD_BLOB_SIZE } from '../utils/v15Password';

interface LoginEvents {
  'login:success': [{ accountId: number; account: string; socket: Socket; handoffToken: string }];
  [event: string]: unknown[];
}

const logger = createLogger({ module: 'auth-handler' });

/** Default v19 protocol version (`NEUZ_MSGVR`, `_Common/LodeConfig.h:9`). */
const DEFAULT_PROTOCOL_VERSION = '20100412';

/**
 * Login certification handler -- `PACKETTYPE_CERTIFY` (0xfc).
 *
 * v19 client->certifier payload (after opcode, `Neuz/DPCertified.cpp:122-165`):
 *   [string protocolVersion][string account][672-byte Rijndael-CBC password blob]
 * The blob decrypts to the 32-char `md5("kikugalanet"+pwd)` lowercase hex; the
 * service argon2-verifies that digest against the stored hash.
 *
 * ## The `resVer` field is deliberately not read
 *
 * `DPCertified.cpp:135-137` writes a fourth field between version and account --
 * `md5` of the whole `Flyff.a` resource manifest -- but only under
 * `#ifdef __SECURITY_0628`. `CERTIFIER/DPCertifier.cpp:241-247` reads it back and
 * replies `ERROR_FLYFF_RESOURCE_MODIFIED` on mismatch.
 *
 * The shipped `Neuz.exe` was **not** built with that flag, so it does not send
 * the field, and reading one here would consume the account string and break
 * every login. Evidence: the binary is unpacked (plaintext `kikugalanet`,
 * `CResFile Open Error`, `propQuest`) yet contains none of the flag's strings
 * (`Flyff.a`, `killed by CResFile::Read()`); and the 3-field parse below has
 * authenticated real clients successfully -- account names arrive as `test` /
 * `test2`, never as a 32-char hex digest.
 *
 * If a client built with `__SECURITY_0628` is ever introduced, add
 * `reader.readString()` between the two reads below and gate it on the client
 * build -- the field cannot be detected from the payload alone, because a
 * length-prefixed string is indistinguishable from the account that follows it.
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

  /** Send a v19 `PACKETTYPE_ERROR` (0xfe) reply: `[opcode][LONG errorCode]`. */
  private sendError(socket: Socket, errorCode: number): void {
    const writer = new PacketWriter();
    writer.writeDword(PACKETTYPE.ERROR);
    writer.writeDword(errorCode);
    sendPacket(socket, writer.build());
  }
}

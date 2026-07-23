import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import net, { type Server, type Socket } from 'node:net';

import { createDb, AccountRepository } from '@flyff/database';
import { up, down } from '@flyff/database/migrations/001_initial';
import { MemoryCache, createEventBus, hashPassword } from '@flyff/core';
import { hashPassword as hashPw } from '@flyff/core/utils/password';
import { PacketWriter } from '@flyff/core/net/PacketWriter';
import { PacketBuffer } from '@flyff/core/net/PacketBuffer';
import { framePacketCrc } from '@flyff/core/net/crcFrame';
import { PACKETTYPE } from '@flyff/core/constants/opcodes';

import { AuthService } from '../../src/services/auth.service';
import { TokenService } from '../../src/services/token.service';
import { AuthHandler } from '../../src/handlers/auth.handler';
import { buildLoginClientServer } from '../../src/clientServer';
import { encryptV15Password } from '../../src/utils/v15Password';

type LoginSuccess = [{ accountId: number; socket: unknown; handoffToken: string }];

/**
 * Full v15 certifier connection over real TCP, matching the REAL client flow:
 *   1. server SENDS the 8-byte protocolId hello (plain-framed) on accept
 *   2. client reads the hello, adopts the id, uses it to CRC all its frames
 *   3. client sends CRC-framed CERTIFY: [str ver][str acct][672B rijndael blob]
 *   4. server decrypts the blob -> md5hex -> argon2-verifies -> ERROR or login:success
 *
 * The certifier is a `crcRead` server: READS 13-byte CRC frames from the client,
 * WRITES plain 5-byte frames back. Framing is asymmetric.
 *
 * Account is seeded with argon2(md5("kikugalanet"+pwd)) -- exactly what the
 * decrypted md5hex is verified against.
 */

const SECRET = 'login-smoke-secret';
const ACCOUNT = 'smoke';
const PASSWORD = 'secret';
const PROTOCOL_VERSION = '20100412';
const SALT = 'kikugalanet';

const md5hex = (pw: string) => createHash('md5').update(SALT + pw).digest('hex');
const VALID_MD5 = md5hex(PASSWORD);

/** CRC-framed v15 CERTIFY. Payload leads with the opcode DWORD (dispatcher strips it). */
function certifyFrame(account: string, md5: string, protocolId: number, version = PROTOCOL_VERSION): Buffer {
  const w = new PacketWriter();
  w.writeDword(PACKETTYPE.CERTIFY);
  w.writeString(version);
  w.writeString(account);
  w.writeBytes(encryptV15Password(md5));
  return framePacketCrc(w.build(), protocolId);
}

const tick = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('Login v15 TCP smoke (CRC frame + hello + rijndael CERTIFY)', () => {
  let db: ReturnType<typeof createDb>;
  let server: Server;
  let port: number;
  let captured: Array<{ accountId: number; handoffToken: string }>;

  before(async () => {
    db = createDb({ client: 'better-sqlite3', connection: ':memory:' });
    await up(db);
    const accountRepo = new AccountRepository(db);
    await accountRepo.create({
      username: ACCOUNT, password_hash: await hashPw(VALID_MD5),
      email: 's@e.com', banned: false, banned_until: null,
    } as never);

    captured = [];
    const cache = new MemoryCache();
    const eventBus = createEventBus<{ 'login:success': LoginSuccess }>();
    eventBus.on('login:success', (d) => captured.push({ accountId: d.accountId, handoffToken: d.handoffToken }));
    const authHandler = new AuthHandler(
      new AuthService(cache, accountRepo),
      new TokenService(cache, SECRET),
      eventBus,
    );

    server = buildLoginClientServer({ authHandler }).server;
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    server.unref();
    port = (server.address() as net.AddressInfo).port;
  });

  after(async () => {
    await down(db);
    await db.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  });

  /**
   * Connect + read the server's protocolId hello (plain-framed `[DWORD 0][DWORD id]`).
   * Returns the socket, the adopted protocolId, and a PacketBuffer that already
   * holds any bytes received after the hello (plain reply frames).
   */
  async function handshake(): Promise<{ sock: Socket; protocolId: number; rx: PacketBuffer }> {
    const sock = await new Promise<Socket>((resolve) => {
      const s = net.createConnection({ host: '127.0.0.1', port }, () => resolve(s));
    });
    const rx = new PacketBuffer();
    const protocolId = await new Promise<number>((resolve, reject) => {
      const onData = (c: Buffer) => {
        rx.push(c);
        const frames = rx.drain();
        if (frames.length > 0) {
          sock.off('data', onData);
          resolve(frames[0]!.readUInt32LE(4)); // hello payload = [DWORD 0][DWORD id]
        }
      };
      sock.on('data', onData);
      setTimeout(() => { sock.off('data', onData); reject(new Error('no hello')); }, 2000);
    });
    return { sock, protocolId, rx };
  }

  it('rejects a bad password with a plain-framed ERROR packet', async () => {
    const { sock, protocolId, rx } = await handshake();
    const reply = await new Promise<Buffer | null>((resolve) => {
      const onData = (c: Buffer) => {
        rx.push(c);
        const frames = rx.drain();
        if (frames.length > 0) { sock.off('data', onData); resolve(frames[0]!); }
      };
      sock.on('data', onData);
      setTimeout(() => { sock.off('data', onData); resolve(null); }, 2000);
      sock.write(certifyFrame(ACCOUNT, md5hex('wrong'), protocolId));
    });
    sock.destroy();
    assert.ok(reply, 'server must reply to a failed CERTIFY');
    assert.equal(reply!.readUInt32LE(0), PACKETTYPE.ERROR);
    assert.equal(reply!.readUInt32LE(4), 120); // ERROR_FLYFF_PASSWORD
  });

  it('authenticates a valid CERTIFY (decrypts the blob, argon2-verifies md5hex)', async () => {
    const before = captured.length;
    const { sock, protocolId } = await handshake();
    sock.write(certifyFrame(ACCOUNT, VALID_MD5, protocolId));
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) { await tick(25); ok = captured.length > before; }
    sock.destroy();
    assert.ok(ok, 'login:success must fire for valid v15 credentials');
    const last = captured[captured.length - 1]!;
    assert.equal(last.accountId, 1);
    assert.ok(last.handoffToken.length > 0);
    void protocolId;
  });

  it('drops the connection when a frame is CRC-framed with the wrong protocolId', async () => {
    const { sock, protocolId } = await handshake();
    // Frame CERTIFY with a DIFFERENT protocolId than the server issued in its
    // hello -- server CRC-verify fails on a fully-buffered frame -> drop.
    sock.write(certifyFrame(ACCOUNT, VALID_MD5, protocolId ^ 0xdeadbeef));
    const closed = await new Promise<boolean>((resolve) => {
      sock.on('close', () => resolve(true));
      setTimeout(() => resolve(false), 1000);
    });
    assert.equal(closed, true, 'socket must be dropped on CRC mismatch');
  });
});

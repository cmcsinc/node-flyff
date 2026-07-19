import { describe, it, before, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import type { Socket } from 'node:net';
import { PacketReader } from '@flyff/core/net/PacketReader.js';
import { PacketWriter } from '@flyff/core/net/PacketWriter.js';
import { AuthHandler } from '../../src/handlers/auth.handler.js';
import { encryptV15Password } from '../../src/utils/v15Password.js';
import type { AuthService } from '../../src/services/auth.service.js';
import type { TokenService } from '../../src/services/token.service.js';
import type { EventBus } from '@flyff/core/eventBus.js';

const V = '20100412';
const MD5HEX = '0123456789abcdef0123456789abcdef'; // 32 chars

/** Build a v15 CERTIFY payload: [str version][str account][672B rijndael blob]. */
function certifyPayload(account: string, md5hex: string, version: string = V): Buffer {
  const w = new PacketWriter();
  w.writeString(version);
  w.writeString(account);
  w.writeBytes(encryptV15Password(md5hex));
  return w.build();
}

function mockSocket() {
  const written: Buffer[] = [];
  return {
    remoteAddress: '127.0.0.1',
    write: (b: Buffer) => { written.push(b); return true; },
    destroy: () => {},
    _written: written,
  } as unknown as Socket & { _written: Buffer[] };
}

describe('AuthHandler (v15 CERTIFY)', () => {
  let authHandler: AuthHandler;
  let mockAuthService: AuthService;
  let mockTokenService: TokenService;
  let emitted: Array<{ event: string; data: unknown }>;

  before(() => {
    mockAuthService = {
      checkRateLimit: async () => true, clearRateLimit: async () => {},
      validateCredentials: async () => ({ accountId: 1, valid: true }),
      createSession: async () => 'sessiontoken',
    } as unknown as AuthService;
    mockTokenService = { generateHandoffToken: async () => 'handoff-token' } as unknown as TokenService;
    emitted = [];
    const bus = { emit: (e: string, d: unknown) => { emitted.push({ event: e, data: d }); }, on: () => {}, off: () => {} } as unknown as EventBus;
    authHandler = new AuthHandler(mockAuthService, mockTokenService, bus);
  });

  beforeEach(() => {
    mockAuthService.checkRateLimit = async () => true;
    mockAuthService.clearRateLimit = async () => {};
    mockAuthService.validateCredentials = async () => ({ accountId: 1, valid: true });
    mockAuthService.createSession = async () => 'sessiontoken';
    emitted.length = 0;
  });

  it('authenticates a valid v15 CERTIFY + emits login:success', async () => {
    const sock = mockSocket();
    await authHandler.handleCertify(sock, new PacketReader(certifyPayload('testuser', MD5HEX)));
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0]!.event, 'login:success');
    assert.equal((emitted[0]!.data as { accountId: number }).accountId, 1);
    assert.equal(sock._written.length, 0);
  });

  it('rejects an illegal protocol version', async () => {
    const sock = mockSocket();
    await authHandler.handleCertify(sock, new PacketReader(certifyPayload('testuser', MD5HEX, '00000000')));
    assert.equal(sock._written.length, 1);
    assert.equal(emitted.length, 0);
  });

  it('rejects an invalid account format', async () => {
    const sock = mockSocket();
    await authHandler.handleCertify(sock, new PacketReader(certifyPayload('user@name', MD5HEX)));
    assert.equal(sock._written.length, 1);
  });

  it('rejects invalid credentials with ERROR_FLYFF_PASSWORD (120)', async () => {
    mockAuthService.validateCredentials = async () => ({ accountId: 0, valid: false });
    const sock = mockSocket();
    await authHandler.handleCertify(sock, new PacketReader(certifyPayload('testuser', MD5HEX)));
    assert.equal(sock._written.length, 1);
    assert.equal(emitted.length, 0);
  });

  it('rejects a banned account with ERROR_BLOCKGOLD_ACCOUNT (119)', async () => {
    mockAuthService.validateCredentials = async () => ({ accountId: 0, valid: false, banned: true });
    const sock = mockSocket();
    await authHandler.handleCertify(sock, new PacketReader(certifyPayload('testuser', MD5HEX)));
    assert.equal(sock._written.length, 1);
  });

  it('honours the rate limiter (ERROR_15SEC_PREVENT, 134)', async () => {
    mockAuthService.checkRateLimit = async () => false;
    const sock = mockSocket();
    await authHandler.handleCertify(sock, new PacketReader(certifyPayload('testuser', MD5HEX)));
    assert.equal(sock._written.length, 1);
    assert.equal(emitted.length, 0);
  });

  it('clears the rate limit on successful auth', async () => {
    let cleared = false;
    mockAuthService.clearRateLimit = async () => { cleared = true; };
    const sock = mockSocket();
    await authHandler.handleCertify(sock, new PacketReader(certifyPayload('testuser', MD5HEX)));
    assert.equal(cleared, true);
  });
});

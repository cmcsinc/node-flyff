import { describe, it, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import { AuthHandler } from '../../src/handlers/auth.handler.js';
import type { AuthService } from '../../src/services/auth.service.js';
import type { TokenService } from '../../src/services/token.service.js';
import type { EventBus } from '@flyff/core/eventBus.js';
import { PacketReader } from '@flyff/core/net/PacketReader.js';
import type { Socket } from 'node:net';

// Mock helper
function makeMockSocket(overrides = {}): Socket {
  const written: Buffer[] = [];
  return {
    remoteAddress: '127.0.0.1',
    write: (buf: Buffer) => {
      written.push(buf);
      return true;
    },
    destroy: () => {},
    on: () => {},
    off: () => {},
    once: () => {},
    emit: () => {},
    ...overrides,
  } as unknown as Socket;
}

describe('AuthHandler', () => {
  let authHandler: AuthHandler;
  let mockAuthService: AuthService;
  let mockTokenService: TokenService;
  let mockEventBus: EventBus;
  let emittedEvents: Array<{ event: string; data: unknown }>;

  before(() => {
    // Mock AuthService
    mockAuthService = {
      checkRateLimit: async () => true,
      clearRateLimit: async () => {},
      validateCredentials: async () => ({ accountId: 1, valid: true }),
      createSession: async () => 'sessiontoken',
    } as unknown as AuthService;

    // Mock TokenService
    mockTokenService = {
      generateHandoffToken: async () => 'handoff-token',
    } as unknown as TokenService;

    // Mock EventBus
    emittedEvents = [];
    mockEventBus = {
      emit: (event: string, data: unknown) => {
        emittedEvents.push({ event, data });
      },
      on: () => {},
      off: () => {},
    } as unknown as EventBus;

    authHandler = new AuthHandler(mockAuthService, mockTokenService, mockEventBus);
  });

  describe('handleCertify', () => {
    it('should handle successful authentication', async () => {
      const socket = makeMockSocket();

      // Build a valid certify packet
      const packetBuffer = Buffer.alloc(100);
      const writer = new (await import('@flyff/core/net/PacketWriter.js')).PacketWriter();
      writer.writeDword(1234); // key
      writer.writeString('testuser'); // username
      writer.writeString('5f4dcc3b5aa765d61d8327deb882cf99'); // MD5 of "password"
      writer.writeDword(1500); // version

      const packet = writer.build();
      const reader = new PacketReader(packet);

      await authHandler.handleCertify(socket, reader);

      // Should emit login:success event
      assert.equal(emittedEvents.length, 1);
      assert.equal(emittedEvents[0].event, 'login:success');
      assert.equal((emittedEvents[0].data as any).accountId, 1);
    });

    it('should reject invalid username length', async () => {
      const socket = makeMockSocket();

      const writer = new (await import('@flyff/core/net/PacketWriter.js')).PacketWriter();
      writer.writeDword(1234);
      writer.writeString('ab'); // Too short
      writer.writeString('5f4dcc3b5aa765d61d8327deb882cf99');
      writer.writeDword(1500);

      const packet = writer.build();
      const reader = new PacketReader(packet);

      await authHandler.handleCertify(socket, reader);

      // Should send error packet
      const written = (socket as any)._written as Buffer[];
      assert.equal(written.length, 1);
    });

    it('should reject invalid username format', async () => {
      const socket = makeMockSocket();

      const writer = new (await import('@flyff/core/net/PacketWriter.js')).PacketWriter();
      writer.writeDword(1234);
      writer.writeString('user@name'); // Invalid characters
      writer.writeString('5f4dcc3b5aa765d61d8327deb882cf99');
      writer.writeDword(1500);

      const packet = writer.build();
      const reader = new PacketReader(packet);

      await authHandler.handleCertify(socket, reader);

      const written = (socket as any)._written as Buffer[];
      assert.equal(written.length, 1);
    });

    it('should reject invalid password length', async () => {
      const socket = makeMockSocket();

      const writer = new (await import('@flyff/core/net/PacketWriter.js')).PacketWriter();
      writer.writeDword(1234);
      writer.writeString('testuser');
      writer.writeString('short'); // Not MD5 format
      writer.writeDword(1500);

      const packet = writer.build();
      const reader = new PacketReader(packet);

      await authHandler.handleCertify(socket, reader);

      const written = (socket as any)._written as Buffer[];
      assert.equal(written.length, 1);
    });

    it('should reject invalid password format', async () => {
      const socket = makeMockSocket();

      const writer = new (await import('@flyff/core/net/PacketWriter.js')).PacketWriter();
      writer.writeDword(1234);
      writer.writeString('testuser');
      writer.writeString('invalid-hash-format!'); // Invalid characters
      writer.writeDword(1500);

      const packet = writer.build();
      const reader = new PacketReader(packet);

      await authHandler.handleCertify(socket, reader);

      const written = (socket as any)._written as Buffer[];
      assert.equal(written.length, 1);
    });

    it('should reject invalid client version', async () => {
      const socket = makeMockSocket();

      const writer = new (await import('@flyff/core/net/PacketWriter.js')).PacketWriter();
      writer.writeDword(1234);
      writer.writeString('testuser');
      writer.writeString('5f4dcc3b5aa765d61d8327deb882cf99');
      writer.writeDword(99); // Too low

      const packet = writer.build();
      const reader = new PacketReader(packet);

      await authHandler.handleCertify(socket, reader);

      const written = (socket as any)._written as Buffer[];
      assert.equal(written.length, 1);
    });

    it('should handle rate limit exceeded', async () => {
      const socket = makeMockSocket();

      // Mock rate limit check to return false
      mockAuthService.checkRateLimit = async () => false;

      const writer = new (await import('@flyff/core/net/PacketWriter.js')).PacketWriter();
      writer.writeDword(1234);
      writer.writeString('testuser');
      writer.writeString('5f4dcc3b5aa765d61d8327deb882cf99');
      writer.writeDword(1500);

      const packet = writer.build();
      const reader = new PacketReader(packet);

      await authHandler.handleCertify(socket, reader);

      // Should send error code 2 (rate limit)
      const written = (socket as any)._written as Buffer[];
      assert.equal(written.length, 1);
    });

    it('should handle invalid credentials', async () => {
      const socket = makeMockSocket();

      mockAuthService.validateCredentials = async () => ({ accountId: 0, valid: false });

      const writer = new (await import('@flyff/core/net/PacketWriter.js')).PacketWriter();
      writer.writeDword(1234);
      writer.writeString('testuser');
      writer.writeString('5f4dcc3b5aa765d61d8327deb882cf99');
      writer.writeDword(1500);

      const packet = writer.build();
      const reader = new PacketReader(packet);

      await authHandler.handleCertify(socket, reader);

      // Should send error code 0 (invalid credentials)
      const written = (socket as any)._written as Buffer[];
      assert.equal(written.length, 1);
    });

    it('should handle banned account', async () => {
      const socket = makeMockSocket();

      mockAuthService.validateCredentials = async () => ({
        accountId: 0,
        valid: false,
        banned: true,
      });

      const writer = new (await import('@flyff/core/net/PacketWriter.js')).PacketWriter();
      writer.writeDword(1234);
      writer.writeString('testuser');
      writer.writeString('5f4dcc3b5aa765d61d8327deb882cf99');
      writer.writeDword(1500);

      const packet = writer.build();
      const reader = new PacketReader(packet);

      await authHandler.handleCertify(socket, reader);

      // Should send error code 6 (banned)
      const written = (socket as any)._written as Buffer[];
      assert.equal(written.length, 1);
    });

    it('should clear rate limit on successful auth', async () => {
      const socket = makeMockSocket();

      let cleared = false;
      mockAuthService.clearRateLimit = async () => {
        cleared = true;
      };

      const writer = new (await import('@flyff/core/net/PacketWriter.js')).PacketWriter();
      writer.writeDword(1234);
      writer.writeString('testuser');
      writer.writeString('5f4dcc3b5aa765d61d8327deb882cf99');
      writer.writeDword(1500);

      const packet = writer.build();
      const reader = new PacketReader(packet);

      await authHandler.handleCertify(socket, reader);

      assert.equal(cleared, true);
    });
  });
});

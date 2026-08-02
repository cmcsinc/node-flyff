import { PacketReader, PacketWriter, PACKETTYPE, createLogger } from '@flyff/core';
import { verifyPassword } from '@flyff/core/utils/password';
import type { ClientSession } from '../ClientSession';
import type { Gateway } from '../Gateway';
import type { CharacterRepository, AccountRepository } from '@flyff/database';
import crypto from 'node:crypto';

const logger = createLogger({ module: 'auth-handler' });

const STARTING_POS = { x: 6967, y: 100, z: 3333 };

/**
 * Client-side pepper the Neuz login field applies before hashing. The
 * login-server's CERTIFY path stores `KDF(md5("kikugalanet" + typed))`
 * (`login-server/src/seed.ts`, `admin/lib/password.ts`); the gateway shares the
 * same `accounts` table, so it must derive the same digest or a row minted by
 * one path fails to verify on the other.
 */
const SALT = 'kikugalanet';

type GatewayGetter = () => Gateway;

export function createAuthHandlers(
  getGateway: GatewayGetter,
  accountRepo: AccountRepository,
  characterRepo: CharacterRepository,
): Record<number, (session: ClientSession, reader: PacketReader) => Promise<void>> {
  return {
    [PACKETTYPE.CERTIFY]: async (session, reader) => {
      const version = reader.readDword();
      const username = reader.readString();
      const password = reader.readString();

      logger.info({ username, version, ip: session.ip }, 'Certify request');

      const account = await accountRepo.findByUsername(username);
      if (!account) {
        const writer = new PacketWriter();
        writer.writeDword(PACKETTYPE.ERROR);
        writer.writeDword(0);
        getGateway().sendToSession(session, writer);
        return;
      }

      // Derive the same digest the login-server stores. A 32-char hex field is
      // already an MD5 from a Neuz-style client; anything else is a typed
      // plaintext password and gets the client-side pepper applied here.
      const md5hex = /^[0-9a-f]{32}$/i.test(password)
        ? password.toLowerCase()
        : crypto.createHash('md5').update(SALT + password).digest('hex');
      // Verify through the shared KDF (argon2id, or the deterministic scrypt
      // fallback). NEVER compare the submitted value against the stored hash
      // directly -- that accepts the hash itself as a password (pass-the-hash).
      const valid = await verifyPassword(md5hex, account.password_hash);
      if (!valid) {
        logger.info({ username }, 'Certify failed: wrong password');
        const writer = new PacketWriter();
        writer.writeDword(PACKETTYPE.ERROR);
        writer.writeDword(0);
        getGateway().sendToSession(session, writer);
        return;
      }

      if (account.banned) {
        const writer = new PacketWriter();
        writer.writeDword(PACKETTYPE.ERROR);
        writer.writeDword(6);
        getGateway().sendToSession(session, writer);
        return;
      }

      session.accountId = account.id;
      session.state = 'authenticated';

      const writer = new PacketWriter();
      writer.writeDword(PACKETTYPE.SRVR_LIST);
      writer.writeByte(1);
      writer.writeByte(1);
      writer.writeString('Flyff Web');
      writer.writeString('127.0.0.1');
      writer.writeDword(0);
      writer.writeDword(1);
      writer.writeDword(100);
      writer.writeDword(1);
      getGateway().sendToSession(session, writer);

      logger.info({ accountId: account.id, username }, 'Certify successful');
    },

    [PACKETTYPE.GETPLAYERLIST]: async (session, reader) => {
      if (!session.accountId) return;

      const account = reader.readString();
      logger.debug({ accountId: session.accountId, account }, 'Player list request');

      const chars = await characterRepo.findByAccountId(session.accountId);

      const writer = new PacketWriter();
      writer.writeDword(PACKETTYPE.PLAYER_LIST);
      writer.writeDword(chars.length);

      for (const ch of chars) {
        writer.writeDword(ch.slot);
        writer.writeString(ch.name);
        writer.writeDword(ch.level);
        writer.writeDword(ch.class ?? 0);
        writer.writeByte(ch.gender ?? 0);
        writer.writeByte(ch.hair_style ?? 1);
        writer.writeByte(ch.hair_color ?? 1);
        writer.writeByte(ch.face_style ?? 1);
        writer.writeByte(ch.skin_color ?? 1);
        writer.writeDword(ch.hp);
        writer.writeDword(ch.max_hp);
        writer.writeDword(ch.mp);
        writer.writeDword(ch.max_mp);
        writer.writeDword(0);
        writer.writeDword(0);
        writer.writeDword(0);
      }

      getGateway().sendToSession(session, writer);
      session.state = 'in_cluster';
      logger.info({ accountId: session.accountId, count: chars.length }, 'Player list sent');
    },

    [PACKETTYPE.CREATE_PLAYER]: async (session, reader) => {
      if (!session.accountId) return;

      const name = reader.readString();
      const slot = reader.readDword();
      const hairStyle = reader.readByte();
      const faceStyle = reader.readByte();
      const gender = reader.readByte();
      const hairColor = reader.readByte();
      const skinColor = reader.readByte();

      logger.info({ accountId: session.accountId, name, slot }, 'Create character');

      const exists = await characterRepo.nameExists(name);
      if (exists) {
        const writer = new PacketWriter();
        writer.writeDword(PACKETTYPE.ERROR);
        writer.writeDword(4);
        getGateway().sendToSession(session, writer);
        return;
      }

      const ch = await characterRepo.create({
        account_id: session.accountId,
        name,
        slot,
        class: 0,
        gender,
        hair_style: hairStyle,
        hair_color: hairColor,
        face_style: faceStyle,
        skin_color: skinColor,
        level: 1,
        exp: 0n,
        hp: 100,
        mp: 50,
        max_hp: 100,
        max_mp: 50,
        strength: 15,
        stamina: 15,
        dexterity: 15,
        intelligence: 15,
        x: STARTING_POS.x,
        y: STARTING_POS.y,
        z: STARTING_POS.z,
        world_id: 'flaris',
        zone_id: 1,
      });

      logger.info({ charId: ch, name }, 'Character created');

      const chars = await characterRepo.findByAccountId(session.accountId);
      const writer = new PacketWriter();
      writer.writeDword(PACKETTYPE.PLAYER_LIST);
      writer.writeDword(chars.length);

      for (const c of chars) {
        writer.writeDword(c.slot);
        writer.writeString(c.name);
        writer.writeDword(c.level);
        writer.writeDword(c.class);
        writer.writeByte(c.gender);
        writer.writeByte(c.hair_style);
        writer.writeByte(c.hair_color);
        writer.writeByte(c.face_style);
        writer.writeByte(c.skin_color);
        writer.writeDword(c.hp);
        writer.writeDword(c.max_hp);
        writer.writeDword(c.mp);
        writer.writeDword(c.max_mp);
        writer.writeDword(0);
        writer.writeDword(0);
        writer.writeDword(0);
      }

      getGateway().sendToSession(session, writer);
    },

    [PACKETTYPE.DELETE_PLAYER]: async (session, reader) => {
      if (!session.accountId) return;
      const slot = reader.readDword();
      const password = reader.readString();

      logger.info({ accountId: session.accountId, slot }, 'Delete character');
      const char = await characterRepo.findByAccountAndSlot(session.accountId, slot);
      if (char) {
        await characterRepo.delete(char.id);
      }

      const chars = await characterRepo.findByAccountId(session.accountId);
      const writer = new PacketWriter();
      writer.writeDword(PACKETTYPE.PLAYER_LIST);
      writer.writeDword(chars.length);

      for (const c of chars) {
        writer.writeDword(c.slot);
        writer.writeString(c.name);
        writer.writeDword(c.level);
        writer.writeDword(c.class);
        writer.writeByte(c.gender);
        writer.writeByte(c.hair_style);
        writer.writeByte(c.hair_color);
        writer.writeByte(c.face_style);
        writer.writeByte(c.skin_color);
        writer.writeDword(c.hp);
        writer.writeDword(c.max_hp);
        writer.writeDword(c.mp);
        writer.writeDword(c.max_mp);
        writer.writeDword(0);
        writer.writeDword(0);
        writer.writeDword(0);
      }

      getGateway().sendToSession(session, writer);
    },
  };
}

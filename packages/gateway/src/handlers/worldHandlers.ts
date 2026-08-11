import { PacketWriter, PACKETTYPE, framePacket, createLogger } from '@flyff/core';
import type { Gateway } from '../Gateway';
import type { World } from '../world/World';
import type { PacketHandlerMap } from '../types';
import type { CharacterRepository } from '@flyff/database';
import type { Mover } from '../world/Mover';

const logger = createLogger({ module: 'world-handler' });

const STARTING_POS = { x: 6967, y: 100, z: 3333 };

type GatewayGetter = () => Gateway;

export function createWorldHandlers(
  getGateway: GatewayGetter,
  world: World,
  characterRepo: CharacterRepository,
): PacketHandlerMap {
  return {
    [PACKETTYPE.PRE_JOIN]: (session): void => {
      if (!session.accountId) return;
      logger.info({ accountId: session.accountId }, 'Pre-join request');

      const writer = new PacketWriter();
      writer.writeDword(PACKETTYPE.JOIN);
      writer.writeDword(session.moverId ?? 0);
      writer.writeByte(0);
      getGateway().sendToSession(session, writer);
    },

    [PACKETTYPE.JOIN]: async (session): Promise<void> => {
      if (!session.accountId) return;
      const moverId = world.allocateMoverId();
      session.moverId = moverId;

      const chars = await characterRepo.findByAccountId(session.accountId);
      const char = chars.find((c) => c.slot === 0) ?? chars[0];

      const pos = char
        ? { x: Number(char.x), y: Number(char.y), z: Number(char.z) }
        : { ...STARTING_POS };

      const mover: Mover = {
        id: moverId,
        type: 'player',
        name: char?.name ?? 'Player',
        pos,
        angle: 0,
        level: char?.level ?? 1,
        hp: char?.hp ?? 100,
        maxHp: char?.max_hp ?? 100,
        mp: char?.mp ?? 50,
        maxMp: char?.max_mp ?? 50,
        classId: char?.class ?? 0,
        gender: char?.gender ?? 0,
        hairStyle: char?.hair_style ?? 1,
        hairColor: char?.hair_color ?? 1,
        faceStyle: char?.face_style ?? 1,
        skinColor: char?.skin_color ?? 1,
        state: 'idle',
        destPos: null,
        lastUpdate: Date.now(),
      };

      if (char) {
        session.characterId = char.id;
      }

      const initWriter = new PacketWriter();
      initWriter.writeDword(PACKETTYPE.JOIN);
      initWriter.writeDword(moverId);
      initWriter.writeByte(0);
      initWriter.writeDword(mover.level);
      initWriter.writeDword(mover.hp);
      initWriter.writeDword(mover.maxHp);
      initWriter.writeDword(mover.mp);
      initWriter.writeDword(mover.maxMp);
      initWriter.writeDword(0);
      initWriter.writeFloat(pos.x);
      initWriter.writeFloat(pos.y);
      initWriter.writeFloat(pos.z);
      initWriter.writeString(mover.name);
      initWriter.writeDword(mover.classId);
      session.ws.send(framePacket(initWriter.build()));

      world.addPlayer(moverId, session, mover);
      session.state = 'in_world';

      logger.info({ moverId, name: mover.name }, 'Player joined world');
    },

    [PACKETTYPE.PLAYERMOVED]: (session, reader): void => {
      if (!session.moverId) return;
      const x = reader.readFloat();
      const y = reader.readFloat();
      const z = reader.readFloat();
      const angle = reader.readFloat();

      world.updatePosition(session.moverId, { x, y, z }, angle);
    },

    [PACKETTYPE.MOVERDESTPOS]: (session, reader): void => {
      if (!session.moverId) return;
      reader.readDword(); // objId -- destination is self-relative, the id is unused
      const x = reader.readFloat();
      const y = reader.readFloat();
      const z = reader.readFloat();

      world.updateDestination(session.moverId, { x, y, z });
    },

    [PACKETTYPE.PLAYERANGLE]: (session, reader): void => {
      if (!session.moverId) return;
      const angle = reader.readFloat();

      const mover = world.getMover(session.moverId);
      if (mover) {
        mover.angle = angle;
      }
    },

    [PACKETTYPE.CHAT]: (session, reader): void => {
      if (!session.moverId) return;
      const chatType = reader.readByte();
      const message = reader.readString();
      const mover = world.getMover(session.moverId);
      if (!mover) return;

      logger.info({ name: mover.name, message, chatType }, 'Chat');

      const writer = new PacketWriter();
      writer.writeDword(PACKETTYPE.CHAT);
      writer.writeByte(chatType);
      writer.writeDword(mover.id);
      writer.writeString(mover.name);
      writer.writeString(message);

      const payload = writer.build();
      const framed = framePacket(payload);
      const nearby = world.getMoversInRadius(mover.pos, 5000);
      for (const other of nearby) {
        if (other.id === session.moverId) continue;
        const otherSession = Array.from(getGateway().getSessions()).find((s) => s.moverId === other.id);
        if (otherSession && otherSession.ws.readyState === 1) {
          otherSession.ws.send(framed);
        }
      }
      session.ws.send(framed);
    },

    [PACKETTYPE.PING]: (session): void => {
      const writer = new PacketWriter();
      writer.writeDword(PACKETTYPE.PING);
      getGateway().sendToSession(session, writer);
    },

    [PACKETTYPE.LEAVE]: async (session): Promise<void> => {
      if (!session.moverId) return;
      const mover = world.removePlayer(session.moverId);
      if (mover && session.characterId) {
        await characterRepo.updatePosition(session.characterId, mover.pos.x, mover.pos.y, mover.pos.z);
        logger.info({ moverId: session.moverId, name: mover.name }, 'Player left world, position saved');
      }
      session.moverId = null;
      session.state = 'authenticated';
    },
  };
}

import type { PacketReader } from '@flyff/core';
import type { ClientSession } from './ClientSession';

export type PacketHandler = (session: ClientSession, reader: PacketReader) => void | Promise<void>;
export type PacketHandlerMap = Record<number, PacketHandler>;

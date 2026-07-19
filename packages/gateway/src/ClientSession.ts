import type { WebSocket } from 'ws';
import type { PacketBuffer } from '@flyff/core';

export type SessionState = 'connected' | 'authenticated' | 'in_cluster' | 'in_world';

export interface ClientSession {
  ws: WebSocket;
  ip: string;
  state: SessionState;
  buffer: PacketBuffer;
  accountId: number | null;
  characterId: number | null;
  moverId: number | null;
  data: Record<string, unknown>;
}

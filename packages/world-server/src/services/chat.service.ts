/**
 * ChatService -- `PACKETTYPE_CHAT` (0x00ff0000) business logic.
 *
 * `DPSrvr::OnChat` (`DPSrvr.cpp:650`):
 *   1. Drop if `uBufSize > 1031` (4 + 4 + 1024 - 1).
 *   2. Read `DWORD dwAuth` (client-claimed authority) + the chat string.
 *   3. Replace literal `\n` / `@` / `@@` with space.
 *   4. If `text[0] == '/'` and `ParsingCommand` accepts -> command path.
 *   5. Else `g_UserMng.AddChat(pUser, strChat)` -> S->C vicinity chat.
 *
 * The `dwAuth` anti-cheat (mismatch => boot) is enforced in the handler, which
 * owns the socket -- the service only sees the trusted `CPlayer`. TALK_MODE /
 * mute checks omitted (no buff/mute system yet).
 *
 * The sender's name is trusted from the session's player entity -- never from
 * the packet (rule 03). No WAL (rule 04 -- chat is not journaled).
 *
 * @module services/chat.service
 */

import type { ZoneManager } from '../managers/zone.manager';
import type { CPlayer } from '../entities/player';
import type { CommandService } from './command.service';
import { ChatSerializer } from '../net/snapshot/chat.serializer';
import { VISIBILITY_RADIUS } from '../net/snapshot/constants';

export interface ChatServiceDeps {
  zoneManager: ZoneManager;
  commandService: CommandService;
}

export type ChatOutcome =
  | { ok: true; reached: number }
  | { ok: false; reason: 'empty' | 'too_long' | 'command_unknown' | 'command_no_auth' };

/** Byte cap on chat text -- `uBufSize > 1031 => drop` (DPSrvr.cpp:653). */
export const MAX_CHAT_LEN = 1024;

export class ChatService {
  private readonly serializer = new ChatSerializer();
  constructor(private readonly deps: ChatServiceDeps) {}

  /** Apply a chat packet from `player`. Returns reach count on broadcast. */
  chat(player: CPlayer, text: string): ChatOutcome {
    // C++ replaces "\\n", "@", "@@" with spaces (OnChat:658-660).
    const sanitized = text.replace(/\\n|@+/g, ' ');
    if (sanitized.length === 0) return { ok: false, reason: 'empty' };
    if (sanitized.length > MAX_CHAT_LEN) return { ok: false, reason: 'too_long' };

    if (sanitized[0] === '/') {
      const result = this.deps.commandService.route(player, sanitized);
      if (result.ok) return { ok: true, reached: 0 };
      // Unknown slash-lines fall through to vicinity broadcast in C++ (the
      // client shows "/foo" as plain text). We drop instead so raw slash
      // spam never leaks as chat.
      if (result.reason === 'no_auth') return { ok: false, reason: 'command_no_auth' };
      return { ok: false, reason: 'command_unknown' };
    }

    const packet = this.serializer.build(player.m_idPlayer, sanitized);
    const reached = this.deps.zoneManager.broadcastAround(
      player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS, packet,
    );
    return { ok: true, reached };
  }
}

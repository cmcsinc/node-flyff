/**
 * ChatService — `PACKETTYPE_CHAT` (0x00ff0000) business logic.
 *
 * `DPSrvr::OnChat` (DPSrvr.cpp:663):
 *   1. Reject if `uBufSize > 1031` (4 + 4 + 1024 - 1) — caller-side guard.
 *   2. Read string, replace literal `\n` with space.
 *   3. If first char is `/` and `ParsingCommand` accepts → command path (no broadcast).
 *   4. Otherwise `g_UserMng.AddChat(pUser, strChat)` → S→C CHATTEXT to zone.
 *
 * Command router (`ParsingCommand`) is a giant if/else over `/move`, `/summon`,
 * `/goto`, etc. gated by `m_dwAuthorization`. ponytail: route to a `CommandRouter`
 * once any real commands are needed. For now we only broadcast normal chat.
 *
 * `TALK_MODE` and mute checks omitted (no buff/mute system yet). Sender's name is
 * trusted from the session's player entity — never from the packet (rule 03).
 *
 * No WAL (chat is not in the journal list, rule 04).
 *
 * @module services/chat.service
 */

import type { ZoneManager } from '../managers/zone.manager.js';
import type { CPlayer } from '../entities/player.js';
import { ChatSerializer } from '../net/snapshot/chat.serializer.js';
import { VISIBILITY_RADIUS } from '../net/snapshot/constants.js';

export interface ChatServiceDeps {
  zoneManager: ZoneManager;
}

export type ChatOutcome =
  | { ok: true; reached: number }
  | { ok: false; reason: 'empty' | 'too_long' | 'command_unknown' };

/** Byte cap on chat text — `uBufSize > 1031 ⇒ drop` (DPSrvr.cpp:666). */
export const MAX_CHAT_LEN = 1024;

export class ChatService {
  private readonly serializer = new ChatSerializer();
  constructor(private readonly deps: ChatServiceDeps) {}

  /** Apply a chat packet from `player`. Returns reach count on broadcast. */
  chat(player: CPlayer, text: string): ChatOutcome {
    // C++ replaces literal "\\n" with space; we do the same on the raw string.
    const sanitized = text.replace(/\\n/g, ' ');
    if (sanitized.length === 0) return { ok: false, reason: 'empty' };
    if (sanitized.length > MAX_CHAT_LEN) return { ok: false, reason: 'too_long' };

    // ponytail: route `/cmd` via a CommandRouter once GM/teleport commands ship.
    // For now a leading `/` is treated as unknown command and dropped silently —
    // matches C++ where `ParsingCommand` returns FALSE for unknown commands and
    // the line falls through to broadcast. We drop instead of broadcast to avoid
    // leaking raw slash-commands as plain chat.
    if (sanitized[0] === '/') return { ok: false, reason: 'command_unknown' };

    const packet = this.serializer.build(player.m_idPlayer, {
      speakerName: player.m_szName,
      speakerJobId: player.m_nJob,
      speakerLevel: player.m_nLevel,
      text: sanitized,
    });
    const reached = this.deps.zoneManager.broadcastAround(
      player.m_vPos, player.m_nZoneId, VISIBILITY_RADIUS, packet,
    );
    return { ok: true, reached };
  }
}

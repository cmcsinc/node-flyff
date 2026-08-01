/**
 * Party C->S handlers -- the 8 solo-party opcodes (MsgHdr.h:280-316).
 *
 * Each body is parsed from the `PacketReader`, validated against the socket's
 * session (anti-forgery -- the client-sent `uLeaderId`/`idPlayer` must match
 * the session player), and delegated to {@link PartyService}. All send paths
 * are inside the service (member-loop) -- handlers never call `socket.write`.
 *
 * Wire layouts (Neuz/DPClient.cpp:9583-9637):
 *   MEMBERREQUEST        `u_long uLeaderId, u_long uMemberId, BYTE bTroup`
 *   MEMBERREQUESTCANCLE  `u_long uLeader, u_long uMember, int nMode`
 *   ADDPARTYMEMBER       `u_long uLeaderId, u_long uMemberId` (accept)
 *   REMOVEPARTYMEMBER    `u_long uLeaderId, u_long uMemberId` (leave/kick)
 *   PARTYCHANGELEADER    `u_long uLeaderId, u_long uChangerLeaderid`
 *   PARTYCHANGEITEMMODE  `u_long idPlayer, int nItemMode`
 *   PARTYCHANGEEXPMODE   `u_long idPlayer, int nExpMode`
 *   PARTYCHAT            `DWORD dpidUser, u_long idParty, String msg`
 *
 * Guards (rule 03): session IN_WORLD, player resolves, ids match session.
 *
 * @module handlers/party
 */

import { PacketReader } from '@flyff/core/net/PacketReader';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { PacketError } from '@flyff/core/errors';
import { Validate } from '@flyff/core/utils/validate';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { PartyService } from '../services/party.service';

const logger = createLogger({ module: 'party-handler' });

export interface PartyHandlerDeps {
  playerManager: PlayerManager;
  partyService: PartyService;
}

export class PartyHandler {
  constructor(private readonly deps: PartyHandlerDeps) {}

  /** MEMBERREQUEST (0xffffff17) -- leader invites `uMemberId`. */
  handleMemberRequest(socket: ClientSocket, reader: PacketReader): void {
    const player = this.resolve(socket);
    if (!player) return;
    try {
      const uLeaderId = reader.readDword();
      const uMemberId = reader.readDword();
      reader.readByte(); // bTroup (ignored -- solo only)
      if (uLeaderId !== player.m_idPlayer) return;
      this.deps.partyService.invite(player, uMemberId);
    } catch (error) {
      if (error instanceof PacketError) { logger.warn({ err: error, charId: player.m_idPlayer }, 'MEMBERREQUEST parse failed'); return; }
      throw error;
    }
  }

  /** MEMBERREQUESTCANCLE (0xffffff18) -- target declines the pending invite. */
  handleMemberRequestCancle(socket: ClientSocket, reader: PacketReader): void {
    const player = this.resolve(socket);
    if (!player) return;
    try {
      const uMember = reader.readDword(); // first field is uLeader in C++ but Neuz sends self
      void reader.readDword(); // uLeader (unused -- resolved from pending slot)
      void reader.readDword(); // nMode
      if (uMember !== player.m_idPlayer) return;
      this.deps.partyService.decline(player);
    } catch (error) {
      if (error instanceof PacketError) { logger.warn({ err: error, charId: player.m_idPlayer }, 'MEMBERREQUESTCANCLE parse failed'); return; }
      throw error;
    }
  }

  /** ADDPARTYMEMBER (0xffffff11) -- target accepts the invite from `uLeaderId`. */
  handleAddPartyMember(socket: ClientSocket, reader: PacketReader): void {
    const player = this.resolve(socket);
    if (!player) return;
    try {
      const uLeaderId = reader.readDword();
      void reader.readDword(); // uMemberId (echoed; we use the session player)
      this.deps.partyService.accept(player, uLeaderId);
    } catch (error) {
      if (error instanceof PacketError) { logger.warn({ err: error, charId: player.m_idPlayer }, 'ADDPARTYMEMBER parse failed'); return; }
      throw error;
    }
  }

  /** REMOVEPARTYMEMBER (0xffffff12) -- leave (self) or kick (leader). */
  handleRemovePartyMember(socket: ClientSocket, reader: PacketReader): void {
    const player = this.resolve(socket);
    if (!player) return;
    try {
      void reader.readDword(); // uLeaderId (unused -- requester resolved from session)
      const uMemberId = reader.readDword();
      this.deps.partyService.leaveOrKick(player, uMemberId);
    } catch (error) {
      if (error instanceof PacketError) { logger.warn({ err: error, charId: player.m_idPlayer }, 'REMOVEPARTYMEMBER parse failed'); return; }
      throw error;
    }
  }

  /** PARTYCHANGELEADER (0xffffff2f) -- leader promotes `uChangerLeaderid`. */
  handlePartyChangeLeader(socket: ClientSocket, reader: PacketReader): void {
    const player = this.resolve(socket);
    if (!player) return;
    try {
      void reader.readDword(); // uLeaderId (unused)
      const uChangeLeaderId = reader.readDword();
      this.deps.partyService.changeLeader(player, uChangeLeaderId);
    } catch (error) {
      if (error instanceof PacketError) { logger.warn({ err: error, charId: player.m_idPlayer }, 'PARTYCHANGELEADER parse failed'); return; }
      throw error;
    }
  }

  /** PARTYCHANGEITEMMODE (0xffffff20) -- leader sets the item share mode. */
  handlePartyChangeItemMode(socket: ClientSocket, reader: PacketReader): void {
    const player = this.resolve(socket);
    if (!player) return;
    try {
      void reader.readDword(); // idPlayer (unused)
      const nItemMode = reader.readDword();
      this.deps.partyService.changeItemMode(player, nItemMode);
    } catch (error) {
      if (error instanceof PacketError) { logger.warn({ err: error, charId: player.m_idPlayer }, 'PARTYCHANGEITEMMODE parse failed'); return; }
      throw error;
    }
  }

  /** PARTYCHANGEEXPMODE (0xffffff21) -- leader sets the exp share mode. */
  handlePartyChangeExpMode(socket: ClientSocket, reader: PacketReader): void {
    const player = this.resolve(socket);
    if (!player) return;
    try {
      void reader.readDword(); // idPlayer (unused)
      const nExpMode = reader.readDword();
      this.deps.partyService.changeExpMode(player, nExpMode);
    } catch (error) {
      if (error instanceof PacketError) { logger.warn({ err: error, charId: player.m_idPlayer }, 'PARTYCHANGEEXPMODE parse failed'); return; }
      throw error;
    }
  }

  /** PARTYCHAT (0xffffff59) -- member-loop party chat. */
  handlePartyChat(socket: ClientSocket, reader: PacketReader): void {
    const player = this.resolve(socket);
    if (!player) return;
    try {
      void reader.readDword(); // dpidUser (unused -- sender resolved from session)
      void reader.readDword(); // idParty (unused -- party resolved from membership)
      const msg = reader.readString();
      this.deps.partyService.chat(player, msg);
    } catch (error) {
      if (error instanceof PacketError) { logger.warn({ err: error, charId: player.m_idPlayer }, 'PARTYCHAT parse failed'); return; }
      throw error;
    }
  }

  /**
   * SETNAVIPOINT (0x00ff0018) -- navigator map ping.
   * `CWndNavigator::OnLButtonDown` (WndField.cpp:12123) sends
   * `D3DXVECTOR3 Pos, OBJID objidTarget`. Pos is world coords (client fills
   * x/z from the click, y stays 0); objidTarget is the focused player's objid,
   * or NULL_ID to ping the pinger's whole party.
   */
  handleSetNaviPoint(socket: ClientSocket, reader: PacketReader): void {
    const player = this.resolve(socket);
    if (!player) return;
    try {
      const x = reader.readFloat();
      const y = reader.readFloat();
      const z = reader.readFloat();
      const objidTarget = reader.readDword();
      Validate.pos(x, y, z);
      Validate.dword(objidTarget);
      this.deps.partyService.naviPoint(player, { x, y, z }, objidTarget);
    } catch (error) {
      if (error instanceof PacketError) { logger.warn({ err: error, charId: player.m_idPlayer }, 'SETNAVIPOINT parse failed'); return; }
      throw error;
    }
  }

  private resolve(socket: ClientSocket): CPlayerLike | null {
    if (socket.session.state !== SessionState.IN_WORLD) { socket.destroy(); return null; }
    const id = socket.session.charId;
    if (id === undefined) { socket.destroy(); return null; }
    const player = this.deps.playerManager.get(id);
    if (!player) { socket.destroy(); return null; }
    return player as CPlayerLike;
  }
}

/** Structural surface this handler reads off a CPlayer (avoids the import cycle). */
interface CPlayerLike {
  readonly m_idPlayer: number;
  readonly m_szName: string;
}

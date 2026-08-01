/**
 * Party C->S handlers -- the 8 solo-party opcodes (MsgHdr.h:280-316).
 *
 * Each body is parsed from the `PacketReader`, validated against the socket's
 * session (anti-forgery -- the client-sent `uLeaderId`/`idPlayer` must match
 * the session player), and delegated to {@link PartyService}. All send paths
 * are inside the service (member-loop) -- handlers never call `socket.write`.
 *
 * Wire layouts (`Neuz/DPClient.cpp` senders; every param is 4 bytes -- the live
 * `CAr` template writes `sizeof(T)` and `u_long`/`LONG`/`DWORD`/`int`/`BOOL`
 * are all 4 on Win32, so there is NO byte field in any of these):
 *   MEMBERREQUEST        `u_long uLeaderId, u_long uMemberId, BOOL bTroup`      (:9506)
 *   MEMBERREQUESTCANCLE  `u_long uLeader, u_long uMember, int nMode`           (:9513)
 *   ADDPARTYMEMBER       `u_long uLeader, LONG nLLevel, LONG nLJob, DWORD dwLSex,
 *                         u_long uMember, LONG nMLevel, LONG nMJob, DWORD dwMSex` (:9520)
 *   REMOVEPARTYMEMBER    `u_long LeaderId, u_long MemberId`                    (:9528)
 *   PARTYCHANGELEADER    `u_long uLeaderId, u_long uChangerLeaderid`           (:9555)
 *   PARTYCHANGEITEMMODE  `u_long idPlayer, int nItemMode`                      (:9485)
 *   PARTYCHANGEEXPMODE   `u_long idPlayer, int nExpMode`                       (:9492)
 *   PARTYCHAT            `OBJID objid, u_long idPlayer, String msg`
 *
 * Note ADDPARTYMEMBER is NOT `(uLeader, uMember)` -- the second DWORD is the
 * leader's LEVEL. The invitee id is field 5. We resolve the member from the
 * session anyway (C++ CoreServer does the same, `DPCacheSrvr.cpp:790`), so only
 * field 1 is read.
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
      reader.readDword(); // BOOL bTroup -- 4 bytes, ignored (solo party only)
      if (uLeaderId !== player.m_idPlayer) return;
      this.deps.partyService.invite(player, uMemberId);
    } catch (error) {
      if (error instanceof PacketError) { logger.warn({ err: error, charId: player.m_idPlayer }, 'MEMBERREQUEST parse failed'); return; }
      throw error;
    }
  }

  /**
   * MEMBERREQUESTCANCLE (0xffffff18) -- the invitee declines.
   * `CWndPartyConfirm::OnChildNotify` (WndPartyConfirm.cpp:114) calls
   * `SendPartyMemberCancle(m_uLeader, m_uMember)`, so field 1 is the LEADER
   * and field 2 is the invitee (self). We validate field 2 against the session.
   */
  handleMemberRequestCancle(socket: ClientSocket, reader: PacketReader): void {
    const player = this.resolve(socket);
    if (!player) return;
    try {
      void reader.readDword(); // uLeader (resolved from the pending slot instead)
      const uMember = reader.readDword();
      void reader.readDword(); // nMode
      if (uMember !== player.m_idPlayer) return;
      this.deps.partyService.decline(player);
    } catch (error) {
      if (error instanceof PacketError) { logger.warn({ err: error, charId: player.m_idPlayer }, 'MEMBERREQUESTCANCLE parse failed'); return; }
      throw error;
    }
  }

  /**
   * ADDPARTYMEMBER (0xffffff11) -- the invitee accepts. Only field 1
   * (`uLeader`) is used; the accepting member is the session player, matching
   * `CDPCacheSrvr::OnAddPartyMember` which uses `GetPlayerBySerial(dpidUser)`
   * rather than the client-sent member id.
   */
  handleAddPartyMember(socket: ClientSocket, reader: PacketReader): void {
    const player = this.resolve(socket);
    if (!player) return;
    try {
      const uLeaderId = reader.readDword();
      // Remaining 7 DWORDs (leader lv/job/sex, member id/lv/job/sex) are echoed
      // client state -- ignored, all party facts come from server-side players.
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

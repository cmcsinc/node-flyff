/**
 * Friend handlers -- the 6 client-facing roster opcodes.
 *
 * Bodies (from `Neuz/DPClient.cpp` sends, confirmed against the C++ reads):
 *   ADDFRIEND (0xffffff60, :11066)     `u_long uidPlayer, u_long myId,
 *                                       BYTE nSex, BYTE mySex,
 *                                       LONG nJob, LONG myJob`
 *   ADDFRIENDREQEST (:11078)           `u_long myId, u_long uidTarget`
 *   ADDFRIENDNAMEREQEST (:11088)       `u_long myId` + String szName[64]
 *   ADDFRIENDCANCEL (:11096)           `u_long uidLeader, u_long uidMember`
 *   GETFRIENDSTATE (:11154)            `u_long myId`  (value ignored by C++)
 *   SETFRIENDSTATE (:11162)            `u_long myId, int state`
 *   REMOVEFRIEND (:11180)              `u_long myId, u_long uidPlayer`
 *
 * **Every one of these carries the actor's own id in the body**, and C++ trusts
 * it (`GetUserByPlayerID( uLeaderid )`). We resolve the actor from the session
 * instead and only log a mismatch -- see the FriendService module doc.
 *
 * @module social/handlers/friend.handler
 */

import type { PacketReader } from '@flyff/core/net/PacketReader';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { Validate } from '@flyff/core/utils/validate';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { PlayerManager } from '@flyff/world-core';
import type { CPlayer } from '@flyff/entities';
import type { FriendService } from '../services/friend.service';

const logger = createLogger({ module: 'friend-handler' });

/** Client `szMemberName[64]` cap (`DPSrvr.cpp:1576`). */
const MAX_MEMBER_NAME = 64;

export class FriendHandler {
  constructor(
    private playerManager: PlayerManager,
    private friendService: FriendService,
  ) {}

  /** ADDFRIEND -- accept an invite. The leader is the FIRST id in the body. */
  handleAddFriend(socket: ClientSocket, reader: PacketReader): void {
    const player = this.resolve(socket);
    if (!player) return;
    try {
      const leaderId = reader.readDword();
      const claimedSelf = reader.readDword();
      // Remaining sex/job fields are the client's copy of both parties' data;
      // we already hold the authoritative values, so they are read and dropped.
      reader.readByte(); reader.readByte();
      reader.readDword(); reader.readDword();
      this.warnSpoof(player, claimedSelf, 'ADDFRIEND');
      void this.friendService.accept(player, leaderId)
        .then((out) => logger.debug({ charId: player.m_idPlayer, leaderId, out }, 'ADDFRIEND'))
        .catch((err: unknown) => logger.error({ err, charId: player.m_idPlayer }, 'ADDFRIEND failed'));
    } catch (error) {
      this.onParseError(error, player, 'ADDFRIEND');
    }
  }

  /** ADDFRIENDREQEST -- invite by id. */
  handleRequest(socket: ClientSocket, reader: PacketReader): void {
    const player = this.resolve(socket);
    if (!player) return;
    try {
      const claimedSelf = reader.readDword();
      const targetId = reader.readDword();
      Validate.dword(targetId);
      this.warnSpoof(player, claimedSelf, 'ADDFRIENDREQEST');
      const out = this.friendService.request(player, targetId);
      logger.debug({ charId: player.m_idPlayer, targetId, out }, 'ADDFRIENDREQEST');
    } catch (error) {
      this.onParseError(error, player, 'ADDFRIENDREQEST');
    }
  }

  /** ADDFRIENDNAMEREQEST -- invite by typed name. */
  handleRequestByName(socket: ClientSocket, reader: PacketReader): void {
    const player = this.resolve(socket);
    if (!player) return;
    try {
      const claimedSelf = reader.readDword();
      const name = reader.readString();
      if (name.length === 0 || name.length > MAX_MEMBER_NAME) return;
      this.warnSpoof(player, claimedSelf, 'ADDFRIENDNAMEREQEST');
      void this.friendService.requestByName(player, name)
        .then((out) => logger.debug({ charId: player.m_idPlayer, name, out }, 'ADDFRIENDNAMEREQEST'))
        .catch((err: unknown) => logger.error({ err, charId: player.m_idPlayer }, 'name request failed'));
    } catch (error) {
      this.onParseError(error, player, 'ADDFRIENDNAMEREQEST');
    }
  }

  /**
   * ADDFRIENDCANCEL -- the invitee declined. The body's FIRST id is the leader
   * (who gets the reply); the second is the member and is discarded, exactly as
   * C++ does (`DPSrvr.cpp:1616`).
   */
  handleCancel(socket: ClientSocket, reader: PacketReader): void {
    const player = this.resolve(socket);
    if (!player) return;
    try {
      const leaderId = reader.readDword();
      reader.readDword();                    // uMemberid -- unused
      const out = this.friendService.cancel(player, leaderId);
      logger.debug({ charId: player.m_idPlayer, leaderId, out }, 'ADDFRIENDCANCEL');
    } catch (error) {
      this.onParseError(error, player, 'ADDFRIENDCANCEL');
    }
  }

  /** GETFRIENDSTATE -- full roster status list. Body id is ignored (as in C++). */
  handleGetState(socket: ClientSocket, reader: PacketReader): void {
    const player = this.resolve(socket);
    if (!player) return;
    try {
      reader.readDword();                    // _uidPlayer -- ignored
      this.friendService.getState(player);
    } catch (error) {
      this.onParseError(error, player, 'GETFRIENDSTATE');
    }
  }

  /** SETFRIENDSTATE -- set own presence status. */
  handleSetState(socket: ClientSocket, reader: PacketReader): void {
    const player = this.resolve(socket);
    if (!player) return;
    try {
      reader.readDword();                    // _uidPlayer -- ignored
      const state = reader.readDword() | 0;  // int
      const out = this.friendService.setState(player, state);
      logger.debug({ charId: player.m_idPlayer, state, out }, 'SETFRIENDSTATE');
    } catch (error) {
      this.onParseError(error, player, 'SETFRIENDSTATE');
    }
  }

  /** REMOVEFRIEND -- drop a friend (both directions). */
  handleRemove(socket: ClientSocket, reader: PacketReader): void {
    const player = this.resolve(socket);
    if (!player) return;
    try {
      reader.readDword();                    // _uidPlayer -- ignored
      const friendId = reader.readDword();
      Validate.dword(friendId);
      void this.friendService.remove(player, friendId)
        .then((out) => logger.debug({ charId: player.m_idPlayer, friendId, out }, 'REMOVEFRIEND'))
        .catch((err: unknown) => logger.error({ err, charId: player.m_idPlayer }, 'REMOVEFRIEND failed'));
    } catch (error) {
      this.onParseError(error, player, 'REMOVEFRIEND');
    }
  }

  private resolve(socket: ClientSocket): CPlayer | undefined {
    if (socket.session.state !== SessionState.IN_WORLD) { socket.destroy(); return undefined; }
    const player = this.playerManager.get(socket.session.charId ?? -1);
    if (!player) { socket.destroy(); return undefined; }
    return player;
  }

  /**
   * Log when the client's self-id disagrees with the session. C++ would have
   * ACTED as the claimed player here; we act as the session owner and record the
   * attempt.
   */
  private warnSpoof(player: CPlayer, claimedSelf: number, label: string): void {
    if (claimedSelf !== player.m_idPlayer) {
      logger.warn({ charId: player.m_idPlayer, claimedSelf, label },
        'friend packet claims a different actor id -- using session id');
    }
  }

  private onParseError(error: unknown, player: CPlayer, label: string): void {
    if (error instanceof PacketError) {
      logger.warn({ err: error, charId: player.m_idPlayer }, `${label} parse failed`);
      return;
    }
    throw error;
  }
}

/**
 * Mail (post) C->S handlers -- the five packets the v19 Post window emits.
 *
 * | Packet | Opcode | Payload | C++ handler |
 * | --- | --- | --- | --- |
 * | QUERYMAILBOX | 0x1d | *(empty)* | `DPSrvr.cpp:7526` |
 * | READMAIL | 0x24 | `nMail:DWORD` | `DPSrvr.cpp:7498` |
 * | QUERYGETMAILITEM | 0x1c | `nMail:DWORD` | `DPSrvr.cpp:7417` |
 * | QUERYGETMAILGOLD | 0x1f | `nMail:DWORD` | `DPSrvr.cpp:7470` |
 * | QUERYREMOVEMAIL | 0x1b | `nMail:DWORD` | `DPSrvr.cpp:7389` |
 *
 * UI triggers (`_Interface/WndField.cpp`): opening the Post window sends
 * QUERYMAILBOX (:15888); `CWndPostRead::SetValue` sends READMAIL (:16743);
 * right-clicking the item / gold box sends GETMAILITEM (:16851) / GETMAILGOLD
 * (:16866); the delete-confirm Yes button sends REMOVEMAIL (:17030).
 *
 * Every reply is a REMOVEMAIL ack (`nType` selects which part of the mail the
 * client drops) except the mailbox itself. Rejected paths send nothing, which
 * matches the C++ silent `return` on the corresponding failures. ponytail:
 * DEFINEDTEXT `TID_GAME_LACKSPACE` on a bag-full take-item -- add when a
 * defined-text channel is wired here.
 *
 * @module handlers/mail
 */

import type { PacketReader } from '@flyff/core/net/PacketReader';
import { Validate } from '@flyff/core/utils/validate';
import type { ClientSocket } from '@flyff/core/net/dispatcher';
import { SessionState } from '@flyff/core/constants/sessionState';
import { PacketError } from '@flyff/core/errors';
import { createLogger } from '@flyff/core/logger';
import type { CPlayer } from '@flyff/entities';
import type { PlayerManager } from '@flyff/world-core';
import { CreateItemSnapshotSerializer, buildUpdateItemCount } from '@flyff/inventory';
import { MailService, type MailClaimResult } from '../services/mail.service';
import { MailBoxSerializer } from '../net/snapshot/mailBox.serializer';
import { RemoveMailSerializer } from '../net/snapshot/removeMail.serializer';

const logger = createLogger({ module: 'mail-handler' });

export interface MailHandlerDeps {
  playerManager: PlayerManager;
  mailService: MailService;
  /** Broadcasts MODIFYMODE when MODE_MAILBOX flips. Injected to keep this
   *  package free of a dependency on the world-server snapshot serializers. */
  onModeChanged?: (player: CPlayer, mode: number) => void;
}

export class MailHandler {
  private readonly boxSer = new MailBoxSerializer();
  private readonly removeSer = new RemoveMailSerializer();
  private readonly createItemSer = new CreateItemSnapshotSerializer();

  constructor(private readonly deps: MailHandlerDeps) {}

  /** QUERYMAILBOX (0x1d) -- no payload. Replies with the FULL mailbox. */
  handleQueryMailBox(socket: ClientSocket): void {
    const player = this.resolve(socket);
    if (!player) return;
    void this.sendMailBox(player);
  }

  /** READMAIL (0x24). */
  handleReadMail(socket: ClientSocket, reader: PacketReader): void {
    this.claim(socket, reader, 'read');
  }

  /** QUERYGETMAILITEM (0x1c). */
  handleGetMailItem(socket: ClientSocket, reader: PacketReader): void {
    this.claim(socket, reader, 'item');
  }

  /** QUERYGETMAILGOLD (0x1f). */
  handleGetMailGold(socket: ClientSocket, reader: PacketReader): void {
    this.claim(socket, reader, 'gold');
  }

  /** QUERYREMOVEMAIL (0x1b). */
  handleRemoveMail(socket: ClientSocket, reader: PacketReader): void {
    this.claim(socket, reader, 'delete');
  }

  /**
   * Push the mailbox to a player unprompted -- used on JOIN and after the admin
   * panel injects a mail, so an already-online player sees it without
   * reopening the window.
   */
  async sendMailBox(player: CPlayer): Promise<void> {
    try {
      const mails = await this.deps.mailService.listForPlayer(player.m_idPlayer);
      this.deps.playerManager.sendTo(
        player,
        this.boxSer.build(player.m_idPlayer, player.m_idPlayer, mails),
      );
      await this.syncMode(player);
    } catch (err) {
      logger.error({ err, charId: player.m_idPlayer }, 'mailbox send failed');
    }
  }

  /** Recompute MODE_MAILBOX and broadcast MODIFYMODE only if it flipped. */
  async syncMode(player: CPlayer): Promise<void> {
    const mode = await this.deps.mailService.syncMailboxMode(player);
    if (mode !== null) this.deps.onModeChanged?.(player, mode);
  }

  /** Shared body for the four single-`nMail` packets. */
  private claim(socket: ClientSocket, reader: PacketReader, kind: 'read' | 'item' | 'gold' | 'delete'): void {
    const player = this.resolve(socket);
    if (!player) return;
    let nMail: number;
    try {
      nMail = reader.readDword();
      Validate.dword(nMail);
    } catch (error) {
      if (error instanceof PacketError) {
        logger.warn({ err: error, charId: player.m_idPlayer, kind }, 'mail packet parse failed');
        return;
      }
      throw error;
    }
    void this.runClaim(player, nMail, kind);
  }

  private async runClaim(
    player: CPlayer,
    nMail: number,
    kind: 'read' | 'item' | 'gold' | 'delete',
  ): Promise<void> {
    try {
      const svc = this.deps.mailService;
      const res: MailClaimResult =
        kind === 'read' ? await svc.markRead(player, nMail)
        : kind === 'item' ? await svc.takeItem(player, nMail)
        : kind === 'gold' ? await svc.takeGold(player, nMail)
        : await svc.remove(player, nMail);

      if (!res.ok) {
        logger.debug({ charId: player.m_idPlayer, nMail, kind, reason: res.reason }, 'mail action rejected');
        return;
      }

      // A take-item lands real inventory slots -- echo each one, exactly as the
      // pickup/`/ci` path does, or the icons stay invisible until relog.
      for (const ch of res.changes) {
        this.deps.playerManager.sendTo(
          player,
          ch.isNew
            ? this.createItemSer.buildOne(player.m_idPlayer, ch.itemId, ch.count, ch.objid)
            : buildUpdateItemCount(player.m_idPlayer, ch.objid, ch.count),
        );
      }

      this.deps.playerManager.sendTo(
        player,
        this.removeSer.build(player.m_idPlayer, nMail, MailService.ackType(kind)),
      );
      await this.syncMode(player);
    } catch (err) {
      logger.error({ err, charId: player.m_idPlayer, nMail, kind }, 'mail action failed');
    }
  }

  private resolve(socket: ClientSocket): CPlayer | null {
    if (socket.session.state !== SessionState.IN_WORLD) { socket.destroy(); return null; }
    const charId = socket.session.charId;
    if (charId === undefined) { socket.destroy(); return null; }
    const player = this.deps.playerManager.get(charId);
    if (!player) { socket.destroy(); return null; }
    return player;
  }
}

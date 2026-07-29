/**
 * MailService -- admin->player mail (the v19 "post" system, receive side only).
 *
 * Ports the read path of `CMailBox` / `CPost` (`_Common/post.h`) plus the five
 * world handlers `CDPSrvr::OnQueryMailBox` / `OnQueryReadMail` /
 * `OnQueryGetMailItem` / `OnQueryGetMailGold` / `OnQueryRemoveMail`
 * (`WORLDSERVER/DPSrvr.cpp:7526/7498/7417/7470/7389`).
 *
 * **Not ported (deliberate):** player-to-player sending
 * (`PACKETTYPE_QUERYPOSTMAIL`), the postage fee, the storage-custody fee on
 * old attachments (`DPSrvr.cpp:7442`), and stamped-mail rules. Mail is created
 * by the admin panel writing a `mail` row, so nothing charges a player.
 *
 * The client learns about new mail from the `MODE_MAILBOX` bit, not a push
 * packet -- `CUser::SetPosting` has no caller in the v19 tree, so vanilla never
 * emits SNAPSHOTTYPE_POSTMAIL. {@link syncMailboxMode} is the port of
 * `CUser::AdjustMailboxState` (User.cpp:3689) and must run on JOIN and after
 * every claim/delete.
 *
 * @module services/mail.service
 */

import { createLogger } from '@flyff/core/logger';
import type { CPlayer } from '@flyff/entities';
import { MODE } from '@flyff/entities';
import type { MailRepository, MailRow } from '@flyff/database';
import type { InventoryService } from '@flyff/inventory';
import { MAX_MAIL, type MailWireEntry } from '../net/snapshot/mailBox.serializer';
import { MAIL_TYPE, type MailType } from '../net/snapshot/removeMail.serializer';

const logger = createLogger({ module: 'mail-service' });

/** Reason a claim/delete was rejected. C++ answers most of these with a
 *  DEFINEDTEXT the caller may surface; a silent return matches the rest. */
export type MailFailReason = 'not_found' | 'no_item' | 'no_gold' | 'bag_full' | 'already_taken';

export type MailClaimResult =
  | { ok: true; row: MailRow; changes: MailItemChange[] }
  | { ok: false; reason: MailFailReason };

/** One inventory slot touched by a take-item, so the handler can echo it. */
export interface MailItemChange {
  slot: number;
  objid: number;
  itemId: number;
  count: number;
  isNew: boolean;
}

export interface MailServiceDeps {
  mailRepo: MailRepository;
  inventoryService: InventoryService;
}

export class MailService {
  constructor(private readonly deps: MailServiceDeps) {}

  /**
   * Build the wire entries for a player's mailbox, oldest first, capped at
   * `MAX_MAIL`. Claimed attachments are omitted from the wire (C++ nulls
   * `m_pItemElem` / zeroes `m_nGold` in place once taken), so a claimed mail
   * shows as a plain letter.
   */
  async listForPlayer(charId: number): Promise<MailWireEntry[]> {
    const rows = await this.deps.mailRepo.listByReceiver(charId);
    const now = Date.now();
    return rows.slice(0, MAX_MAIL).map((r) => toWireEntry(r, now));
  }

  /** `OnQueryReadMail` -- flip `m_byRead`, then re-evaluate the mode bit. */
  async markRead(player: CPlayer, nMail: number): Promise<MailClaimResult> {
    const row = await this.ownedRow(player.m_idPlayer, nMail);
    if (!row) return { ok: false, reason: 'not_found' };
    if (!row.read) await this.deps.mailRepo.markRead(nMail);
    return { ok: true, row, changes: [] };
  }

  /**
   * `OnQueryGetMailItem` -- move the attachment into the bag.
   *
   * C++ pre-checks `m_Inventory.GetEmptyCount() < 1` and bails with
   * `TID_GAME_LACKSPACE` (`DPSrvr.cpp:7425`). `InventoryService.addItem`
   * already reports `bag_full` for the same condition and additionally merges
   * onto partial stacks, so we let it make the call -- strictly more permissive
   * than the C++ empty-slot test, in the player's favour.
   *
   * The mail row is NOT deleted; only `taken_item` flips. That mirrors
   * `DPDatabaseClient.cpp:2707`, which acks with `nType = item`.
   *
   * ponytail: refine/element/flags on the attachment are dropped -- `addItem`
   * takes only (itemId, count). Admin mail sends plain items today; wire a
   * slot-state-preserving add when upgraded attachments ship.
   */
  async takeItem(player: CPlayer, nMail: number): Promise<MailClaimResult> {
    const row = await this.ownedRow(player.m_idPlayer, nMail);
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.item_id === null || row.item_count <= 0) return { ok: false, reason: 'no_item' };
    if (row.taken_item) return { ok: false, reason: 'already_taken' };

    const res = this.deps.inventoryService.addItem(player, row.item_id, row.item_count);
    if (!res.ok) return { ok: false, reason: 'bag_full' };

    await this.deps.mailRepo.markTakenItem(nMail);
    logger.info(
      { charId: player.m_idPlayer, nMail, itemId: row.item_id, count: row.item_count },
      'mail item claimed',
    );
    return { ok: true, row, changes: res.changes };
  }

  /**
   * `OnQueryGetMailGold` -- credit the attached penya. `addGold` clamps to
   * `MAX_GOLD` (rule 03), which is the port of the C++ `CanAdd` overflow guard
   * (`DPDatabaseClient.cpp:2742`). Row survives; only `taken_gold` flips.
   */
  async takeGold(player: CPlayer, nMail: number): Promise<MailClaimResult> {
    const row = await this.ownedRow(player.m_idPlayer, nMail);
    if (!row) return { ok: false, reason: 'not_found' };
    const gold = Number(row.gold);
    if (!Number.isFinite(gold) || gold <= 0) return { ok: false, reason: 'no_gold' };
    if (row.taken_gold) return { ok: false, reason: 'already_taken' };

    this.deps.inventoryService.addGold(player, gold);
    await this.deps.mailRepo.markTakenGold(nMail);
    logger.info({ charId: player.m_idPlayer, nMail, gold }, 'mail gold claimed');
    return { ok: true, row, changes: [] };
  }

  /**
   * `OnQueryRemoveMail` -- delete the mail. C++ lets the player delete a mail
   * with an unclaimed attachment (the confirm dialog `CWndPostDeleteConfirm`
   * is the only guard, client-side), so we do too.
   */
  async remove(player: CPlayer, nMail: number): Promise<MailClaimResult> {
    const row = await this.ownedRow(player.m_idPlayer, nMail);
    if (!row) return { ok: false, reason: 'not_found' };
    await this.deps.mailRepo.remove(nMail);
    logger.info({ charId: player.m_idPlayer, nMail }, 'mail deleted');
    return { ok: true, row, changes: [] };
  }

  /**
   * Recompute `MODE_MAILBOX` from the DB and return the new mode ONLY when it
   * changed, so callers broadcast MODIFYMODE exactly when C++ does.
   *
   * Port of `CUser::AdjustMailboxState` (User.cpp:3689) + the set/clear pairs at
   * `DPDatabaseClient.cpp:2624` (mail arrived) and `:2678` (nothing left
   * unclaimed). Call on JOIN and after every claim/delete/admin-send.
   */
  async syncMailboxMode(player: CPlayer): Promise<number | null> {
    const pending = await this.deps.mailRepo.countPending(player.m_idPlayer);
    const had = (player.m_dwMode & MODE.MAILBOX) !== 0;
    const wants = pending > 0;
    if (had === wants) return null;
    player.m_dwMode = wants
      ? player.m_dwMode | MODE.MAILBOX
      : player.m_dwMode & ~MODE.MAILBOX;
    return player.m_dwMode;
  }

  /** Which REMOVEMAIL `nType` acks a given claim call. */
  static ackType(kind: 'read' | 'item' | 'gold' | 'delete'): MailType {
    switch (kind) {
      case 'read': return MAIL_TYPE.READ;
      case 'item': return MAIL_TYPE.ITEM;
      case 'gold': return MAIL_TYPE.GOLD;
      case 'delete': return MAIL_TYPE.MAIL;
    }
  }

  /** Fetch a mail and confirm it belongs to this player (never trust `nMail`). */
  private async ownedRow(charId: number, nMail: number): Promise<MailRow | null> {
    const row = await this.deps.mailRepo.findById(nMail);
    if (!row || row.receiver_id !== charId) return null;
    return row;
  }
}

/** Map a DB row to its wire shape, hiding already-claimed attachments. */
function toWireEntry(r: MailRow, nowMs: number): MailWireEntry {
  const gold = r.taken_gold ? 0 : Number(r.gold);
  return {
    nMail: r.id,
    idSender: r.sender_id,
    gold: Number.isFinite(gold) && gold > 0 ? gold : 0,
    ageSecs: Math.max(0, Math.floor((nowMs - Number(r.created_at_ms)) / 1000)),
    read: r.read,
    title: r.title,
    text: r.text,
    item:
      r.item_id !== null && r.item_count > 0 && !r.taken_item
        ? {
            itemId: r.item_id,
            count: r.item_count,
            flags: r.item_flags,
            refine: r.item_refine,
            durability: r.item_durability,
            element: r.item_element,
            element_level: r.item_element_level,
          }
        : null,
  };
}

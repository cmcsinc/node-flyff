import type { Knex } from '../types';

/** Client hard limits (`ar.cpp:109` — an over-long `ReadString` kills the archive). */
const MAX_TITLE_CHARS = 31;
const MAX_TEXT_CHARS = 255;
/** `MAX_MAIL` — the client mailbox window is a full replace, capped at 50 rows. */
const MAX_MAILBOX = 50;

/**
 * One row of `mail` (migration `017`) — C++ `CMail` (`_Common/post.h:28-61`).
 *
 * `sender_id = 0` renders client-side as the literal "FLYFF"
 * (`WndField.cpp:16700`), i.e. system/admin mail.
 *
 * `gold` is TEXT because penya is `__int64`-wide in C++ and exceeds the safe
 * integer range of a JS number in the extreme — same storage choice as
 * `inventory.gold` / `characters.exp`.
 *
 * `created_at_ms` is absolute; the wire field is an AGE (`now - created`),
 * derived at send time.
 */
export interface MailRow {
  readonly id: number;
  readonly receiver_id: number;
  readonly sender_id: number;
  readonly sender_name: string;
  readonly title: string;
  readonly text: string;
  /** Attached penya as a decimal string ('0' = none). */
  readonly gold: string;
  /** NULL = no attachment. */
  readonly item_id: number | null;
  readonly item_count: number;
  readonly item_flags: number;
  readonly item_refine: number;
  readonly item_element: number;
  readonly item_element_level: number;
  readonly item_durability: number;
  readonly read: boolean;
  readonly taken_item: boolean;
  readonly taken_gold: boolean;
  readonly created_at_ms: number;
}

/**
 * Write-side shape for {@link MailRepository.create}. Everything but the
 * receiver is optional; `title` / `text` are truncated to the client's limits.
 */
export interface MailCreateData {
  readonly receiver_id: number;
  readonly sender_id?: number;
  readonly sender_name?: string;
  readonly title?: string;
  readonly text?: string;
  /** Accepts a number for convenience; normalized to a decimal string. */
  readonly gold?: string | number;
  readonly item_id?: number | null;
  readonly item_count?: number;
  readonly item_flags?: number;
  readonly item_refine?: number;
  readonly item_element?: number;
  readonly item_element_level?: number;
  readonly item_durability?: number;
  readonly created_at_ms?: number;
}

/**
 * Repository for the mailbox.
 *
 * All methods use the Knex query builder (no raw SQL). The attachment is 1:1 in
 * C++ (`CMail::m_pItemElem`, one item per mail), so item fields live on the row
 * — rule `11-database-normalization.md` mandates a child table for 1:N
 * collections, which this is not.
 *
 * Claiming an attachment sets `taken_item` / `taken_gold` and never deletes the
 * row; C++ likewise keeps the mail until `QUERYREMOVEMAIL`
 * (`DPDatabaseClient.cpp:2707/2745`).
 */
export class MailRepository {
  constructor(private db: Knex) {}

  /**
   * Insert one mail. Title and text are truncated to the client's archive
   * limits (31 / 255 chars) rather than rejected — an over-long string makes the
   * client discard the rest of the mailbox packet.
   *
   * @param data - Mail fields; unset ones fall back to the column defaults
   * @returns The new mail's id
   */
  async create(data: MailCreateData): Promise<number> {
    const [row] = await this.db('mail')
      .insert({
        receiver_id: data.receiver_id,
        sender_id: data.sender_id ?? 0,
        sender_name: (data.sender_name ?? '').slice(0, 32),
        title: (data.title ?? '').slice(0, MAX_TITLE_CHARS),
        text: (data.text ?? '').slice(0, MAX_TEXT_CHARS),
        gold: String(data.gold ?? '0'),
        item_id: data.item_id ?? null,
        item_count: data.item_count ?? 0,
        item_flags: data.item_flags ?? 0,
        item_refine: data.item_refine ?? 0,
        item_element: data.item_element ?? 0,
        item_element_level: data.item_element_level ?? 0,
        item_durability: data.item_durability ?? -1,
        created_at_ms: data.created_at_ms ?? Date.now(),
      })
      .returning('id');

    if (row === undefined) throw new Error('INSERT ... RETURNING id yielded no row');
    return row.id;
  }

  /**
   * A receiver's mailbox, oldest first, capped at `MAX_MAIL` (50).
   *
   * @param receiverId - Receiving character ID
   * @returns Mail rows (empty if the mailbox is empty)
   */
  async listByReceiver(receiverId: number): Promise<MailRow[]> {
    const rows: MailRow[] = await this.db('mail')
      .where({ receiver_id: receiverId })
      .orderBy('id', 'asc')
      .limit(MAX_MAILBOX);
    return rows;
  }

  /**
   * Load one mail by id.
   *
   * @param id - Mail ID (`m_nMail`)
   * @returns The row, or null when it does not exist
   */
  async findById(id: number): Promise<MailRow | null> {
    const row = await this.db('mail').where({ id }).first();
    return row ?? null;
  }

  /** Mark as read (`m_byRead`) — set on `READMAIL`. */
  async markRead(id: number): Promise<void> {
    await this.db('mail').where({ id }).update({ read: true });
  }

  /** Mark the item attachment as pulled out (`QUERYGETMAILITEM`). Row survives. */
  async markTakenItem(id: number): Promise<void> {
    await this.db('mail').where({ id }).update({ taken_item: true });
  }

  /** Mark the penya attachment as pulled out (`QUERYGETMAILGOLD`). Row survives. */
  async markTakenGold(id: number): Promise<void> {
    await this.db('mail').where({ id }).update({ taken_gold: true });
  }

  /** Delete one mail (`QUERYREMOVEMAIL`). */
  async remove(id: number): Promise<void> {
    await this.db('mail').where({ id }).del();
  }

  /**
   * Count mails still needing the player's attention: unread, or holding an
   * unclaimed item, or holding unclaimed penya. Drives the `MODE.MAILBOX` bit —
   * zero means the bit can be cleared.
   *
   * The penya test is `gold <> '0'`: {@link MailRepository.create} normalizes
   * every value through `String()`, so '0' is the only zero spelling stored.
   *
   * @param receiverId - Receiving character ID
   * @returns Number of pending mails
   */
  async countPending(receiverId: number): Promise<number> {
    const [row] = await this.db('mail')
      .where({ receiver_id: receiverId })
      .andWhere((qb) => {
        qb.where({ read: false })
          .orWhere(function itemPending() {
            this.whereNotNull('item_id').andWhere({ taken_item: false });
          })
          .orWhere(function goldPending() {
            this.whereNot('gold', '0').andWhere({ taken_gold: false });
          });
      })
      .count({ n: 'id' });

    return Number(row?.n ?? 0);
  }
}

import type { Knex } from '../types';

/**
 * Presence + mail.
 *
 * **`online_players`** — live-session registry. The world server owns the rows:
 * upsert on JOIN, delete on disconnect, `last_seen_ms` bumped by the 30 s
 * checkpoint pass. Readers (admin panel) treat a row as online only while
 * `last_seen_ms` is fresh, so a crashed world leaves stale rows that expire on
 * their own instead of pinning characters "online" forever. No C++ analogue —
 * vanilla tracks presence purely in `CUserMng` memory, but that is unreadable
 * from a separate admin process.
 *
 * **`mail`** — `CMail` (`_Common/post.h:28-61`). One row per mail; the
 * attachment is 1:1 in C++ (`CItemElem* m_pItemElem`, one item per mail), so
 * item fields live on the row rather than a child table — rule 11 mandates a
 * child table for 1:N collections, which this is not.
 *
 * Field mapping (C++ → column):
 *   `m_nMail`      → `id`
 *   `m_idSender`   → `sender_id`   (0 renders client-side as "FLYFF", i.e. system mail)
 *   `m_pItemElem`  → `item_id` / `item_count` / `item_flags` / `item_refine` /
 *                    `item_element` / `item_element_level` / `item_durability`
 *                    (NULL `item_id` = no attachment)
 *   `m_nGold`      → `gold`
 *   `m_tmCreate`   → `created_at_ms` (absolute; the wire field is an AGE, derived at send)
 *   `m_byRead`     → `read`
 *   `m_szTitle`    → `title` (≤31 chars — 32 incl. NUL, and an over-long
 *                    `ReadString` kills the client archive, ar.cpp:109)
 *   `m_szText`     → `text`  (≤255 chars, same reason)
 *
 * `taken_item` / `taken_gold` mark an attachment the player has already pulled
 * out. C++ nulls `m_pItemElem` / zeroes `m_nGold` in place and keeps the row
 * until `QUERYREMOVEMAIL` (`DPDatabaseClient.cpp:2707/2745`); explicit flags
 * make the "already claimed" state auditable from the admin panel.
 *
 * @param db - Knex instance
 */
export async function up(db: Knex): Promise<void> {
  await db.schema.createTable('online_players', (table: any) => {
    table.integer('character_id').primary()
      .references('id').inTable('characters').onDelete('CASCADE');
    table.integer('account_id').unsigned().notNullable();
    table.string('world_id', 32).notNullable();
    table.integer('zone_id').unsigned().notNullable();
    table.string('server_id', 64).notNullable();
    table.bigInteger('last_seen_ms').unsigned().notNullable();
  });

  await db.schema.createTable('mail', (table: any) => {
    table.increments('id').primary();
    table.integer('receiver_id').unsigned().notNullable()
      .references('id').inTable('characters').onDelete('CASCADE');
    table.integer('sender_id').unsigned().notNullable().defaultTo(0);
    table.string('sender_name', 32).notNullable().defaultTo('');
    table.string('title', 32).notNullable().defaultTo('');
    table.text('text').notNullable().defaultTo('');
    table.text('gold').notNullable().defaultTo('0');       // penya is __int64-wide elsewhere; store as text like inventory.gold
    table.integer('item_id').unsigned().nullable();
    table.integer('item_count').unsigned().notNullable().defaultTo(0);
    table.integer('item_flags').unsigned().notNullable().defaultTo(0);
    table.integer('item_refine').unsigned().notNullable().defaultTo(0);
    table.integer('item_element').unsigned().notNullable().defaultTo(0);
    table.integer('item_element_level').unsigned().notNullable().defaultTo(0);
    table.integer('item_durability').notNullable().defaultTo(-1);
    table.boolean('read').notNullable().defaultTo(false);
    table.boolean('taken_item').notNullable().defaultTo(false);
    table.boolean('taken_gold').notNullable().defaultTo(false);
    table.bigInteger('created_at_ms').unsigned().notNullable();
    table.index(['receiver_id'], 'mail_receiver_idx');
  });
}

/** Reverse — drop both tables. */
export async function down(db: Knex): Promise<void> {
  await db.schema.dropTableIfExists('mail');
  await db.schema.dropTableIfExists('online_players');
}

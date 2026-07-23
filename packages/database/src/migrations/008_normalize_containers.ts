import type { Knex } from '../types';

/**
 * Normalize containers: split gold (and the bank password) onto dedicated
 * container tables, off the owner rows.
 *
 * Before this migration a container's scalar state was jammed onto its owner:
 *   characters.gold       = penya carried in the main bag (m_nGold)
 *   characters.bank_pass  = the bank pin (m_szBankPass)
 *   accounts.bank_gold    = penya stored in the bank (m_BankGold)
 * ...and item instances shared the same `inventory` / `bank` tables.
 *
 * After:
 *   inventory        (character_id PK, gold)         -- 1 row per character
 *   inventory_item   (character_id, slot, ...)       -- renamed from `inventory`
 *   bank             (account_id PK, gold, bank_pass)-- 1 row per account
 *   bank_item        (account_id, tab, slot, ...)    -- renamed from `bank`
 *
 * Rule `.claude/rules/11-database-normalization.md`: a container's scalar state
 * lives on the container, never on the owner row. This also makes the bank an
 * independently addressable container (unblocks a future "share-a-bank via an
 * item" feature -- the gold + pin travel with the container).
 *
 * `bank_pass` becomes account-wide (one pin per account). v15's per-character
 * pin is collapsed to the account-shared bank we already ship; backfill takes
 * the first set pin per account, else '0000'.
 *
 * Container rows are created lazily by the repos (`getGold` -> 0 when absent,
 * `setGold` upserts), so no row is fabricated at owner-create time here.
 *
 * SQLite >= 3.35 (shipped by better-sqlite3) supports DROP COLUMN.
 *
 * @param db - Knex instance
 */
export async function up(db: Knex): Promise<void> {
  // --- inventory: rename items -> inventory_item, new container holds gold ---
  await db.schema.renameTable('inventory', 'inventory_item');
  await db.schema.createTable('inventory', (table: any) => {
    table.integer('character_id').primary();
    table.foreign('character_id').references('id').inTable('characters').onDelete('CASCADE');
    table.bigInteger('gold').unsigned().notNullable().defaultTo(0);
    table.timestamps(true, true);
  });
  await db['raw']('INSERT INTO inventory (character_id, gold, created_at, updated_at) SELECT id, gold, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM characters');

  // --- bank: rename items -> bank_item, new container holds gold + bank_pass ---
  await db.schema.renameTable('bank', 'bank_item');
  await db.schema.createTable('bank', (table: any) => {
    table.integer('account_id').primary();
    table.foreign('account_id').references('id').inTable('accounts').onDelete('CASCADE');
    table.bigInteger('gold').unsigned().notNullable().defaultTo(0);
    table.string('bank_pass', 10).notNullable().defaultTo('0000');
    table.timestamps(true, true);
  });
  await db['raw']('INSERT INTO bank (account_id, gold, bank_pass, created_at, updated_at) SELECT id, bank_gold, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM accounts', ['0000']);
  // First set pin per account wins; accounts whose chars all used '0000' stay '0000'.
  await db['raw'](
    `UPDATE bank SET bank_pass = COALESCE(
       (SELECT c.bank_pass FROM characters c
        WHERE c.account_id = bank.account_id AND c.bank_pass != '0000'
        LIMIT 1),
       '0000')`,
  );

  // --- drop the migrated columns off the owner rows ---
  // Native ALTER TABLE DROP COLUMN (SQLite >= 3.35). Knex's dropColumn rebuilds
  // the table inside a NESTED transaction, which collides with the migration
  // runner's outer transaction + foreign_keys pragma on better-sqlite3
  // ("unable to change foreign_keys pragma inside a nested transaction"). The
  // raw statement executes in-place with no extra transaction.
  await db['raw']('ALTER TABLE characters DROP COLUMN gold');
  await db['raw']('ALTER TABLE characters DROP COLUMN bank_pass');
  await db['raw']('ALTER TABLE accounts DROP COLUMN bank_gold');
}

/**
 * Reverse -- restore gold/bank_pass/bank_gold onto the owner rows, drop the
 * container tables, rename the item tables back to `inventory` / `bank`.
 *
 * @param db - Knex instance
 */
export async function down(db: Knex): Promise<void> {
  // Re-add the owner-row columns (default empty), then copy container values back.
  await db.schema.alterTable('characters', (table: any) => {
    table.bigInteger('gold').unsigned().notNullable().defaultTo(0);
    table.string('bank_pass', 10).notNullable().defaultTo('0000');
  });
  await db.schema.alterTable('accounts', (table: any) => {
    table.bigInteger('bank_gold').unsigned().notNullable().defaultTo(0);
  });
  await db['raw']('UPDATE characters SET gold = COALESCE((SELECT gold FROM inventory WHERE inventory.character_id = characters.id), 0)');
  await db['raw'](`UPDATE characters SET bank_pass = COALESCE((SELECT bank_pass FROM bank WHERE bank.account_id = characters.account_id), '0000')`);
  await db['raw']('UPDATE accounts SET bank_gold = COALESCE((SELECT gold FROM bank WHERE bank.account_id = accounts.id), 0)');

  await db.schema.dropTableIfExists('bank');
  await db.schema.dropTableIfExists('inventory');
  await db.schema.renameTable('inventory_item', 'inventory');
  await db.schema.renameTable('bank_item', 'bank');
}

import type { Knex } from '../types.js';

/**
 * Database row interface for one bank item slot (the `bank_item` table).
 *
 * The container's scalar state (gold + bank_pass) lives on the separate `bank`
 * table (1 row per account); this table holds only the per-slot item instances.
 * See rule `.claude/rules/11-database-normalization.md` + migration 008.
 */
export interface BankItemRow {
  id: number;
  account_id: number;
  tab: number;
  slot: number;
  item_id: number;
  quantity: number;
  flags: number;
  durability: number;
  refine: number;
  stats: string | null;
  created_at: Date;
  updated_at: Date;
}

export type BankCreateData = Omit<BankItemRow, 'id' | 'created_at' | 'updated_at'>;

/**
 * Repository for the bank container -- item slots (`bank_item`) + the
 * container's gold and password (`bank`, 1 row per account). Bank is
 * account-shared (Flyff lore): all characters on one account see the same
 * 3 tabs and the same gold/pin. Mirrors {@link InventoryRepository} with a
 * `tab` axis (0..2).
 */
export class BankRepository {
  constructor(private db: Knex) {}

  // --- container state (the `bank` table, 1 row per account) ---

  /** Account-wide bank penya (C++ `m_BankGold[0]`). Returns 0 when no row yet. */
  async getGold(accountId: number): Promise<number> {
    const row = await this.db('bank').where({ account_id: accountId }).select('gold').first();
    return Number(row?.gold ?? 0);
  }

  /** Upsert the account-wide bank penya (absolute new total). */
  async setGold(accountId: number, amount: number): Promise<void> {
    await this.db('bank')
      .insert({ account_id: accountId, gold: amount, created_at: new Date(), updated_at: new Date() })
      .onConflict('account_id')
      .merge({ gold: amount, updated_at: new Date() });
  }

  /**
   * Account-wide bank password (C++ `m_szBankPass`). `'0000'` = no password
   * set. Max 4 chars, plaintext (mirrors the original protocol). Returns
   * `'0000'` when no container row exists yet.
   */
  async getBankPass(accountId: number): Promise<string> {
    const row = await this.db('bank').where({ account_id: accountId }).select('bank_pass').first();
    return row?.bank_pass ?? '0000';
  }

  /** Upsert the account-wide bank password (absolute new value; '0000' = cleared). */
  async setBankPass(accountId: number, bankPass: string): Promise<void> {
    await this.db('bank')
      .insert({ account_id: accountId, bank_pass: bankPass, created_at: new Date(), updated_at: new Date() })
      .onConflict('account_id')
      .merge({ bank_pass: bankPass, updated_at: new Date() });
  }

  // --- item slots (the `bank_item` table) ---

  /** All bank item rows across every tab for an account. */
  async findByAccountId(accountId: number): Promise<BankItemRow[]> {
    return this.db('bank_item').where({ account_id: accountId }).orderBy('tab', 'asc').orderBy('slot', 'asc');
  }

  async getItem(accountId: number, tab: number, slot: number): Promise<BankItemRow | null> {
    const rows = await this.db('bank_item')
      .where({ account_id: accountId, tab, slot })
      .limit(1);
    return rows[0] || null;
  }

  async setItem(
    accountId: number,
    tab: number,
    slot: number,
    itemId: number,
    quantity: number = 1,
    flags: number = 0,
    durability: number = -1,
    refine: number = 0,
    stats?: string | null,
  ): Promise<void> {
    await this.db('bank_item')
      .insert({
        account_id: accountId,
        tab,
        slot,
        item_id: itemId,
        quantity,
        flags,
        durability,
        refine,
        stats: stats || null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .onConflict(['account_id', 'tab', 'slot'])
      .merge({
        item_id: itemId,
        quantity,
        flags,
        durability,
        refine,
        stats: stats || null,
        updated_at: new Date(),
      });
  }

  async removeItem(accountId: number, tab: number, slot: number): Promise<void> {
    await this.db('bank_item').where({ account_id: accountId, tab, slot }).del();
  }

  async updateQuantity(accountId: number, tab: number, slot: number, quantity: number): Promise<void> {
    await this.db('bank_item').where({ account_id: accountId, tab, slot }).update({ quantity, updated_at: new Date() });
  }
}

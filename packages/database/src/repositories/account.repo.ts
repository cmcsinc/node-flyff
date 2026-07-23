import type { Knex } from '../types';

/**
 * Database row interface for accounts table.
 */
export interface AccountRow {
  id: number;
  username: string;
  password_hash: string;
  email: string | null;
  gm: boolean;
  banned: boolean;
  banned_until: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Account creation data (excludes auto-generated fields).
 */
export type AccountCreateData = Omit<
  AccountRow,
  'id' | 'created_at' | 'updated_at'
>;

/**
 * Account update data (all fields optional).
 */
export type AccountUpdateData = Partial<Omit<
  AccountRow,
  'id' | 'created_at'
>>;

/**
 * Repository for account-related database operations.
 *
 * All methods use Knex query builder (no raw SQL).
 * Methods return typed promises or null if not found.
 */
export class AccountRepository {
  constructor(private db: Knex) {}

  /**
   * Coerces raw DB row boolean fields (stored as 0/1 integers) to booleans.
   * better-sqlite3 returns raw integers; this keeps the AccountRow type honest.
   */
  private mapRow(row: AccountRow | undefined): AccountRow | null {
    if (!row) return null;
    return {
      ...row,
      gm: Boolean(row.gm),
      banned: Boolean(row.banned),
    };
  }

  /**
   * Find account by ID.
   *
   * @param id - Account ID
   * @returns Account row or null if not found
   */
  async findById(id: number): Promise<AccountRow | null> {
    const rows = await this.db('accounts')
      .where({ id })
      .limit(1);

    return this.mapRow(rows[0]);
  }

  /**
   * Find account by username.
   *
   * @param username - Account username
   * @returns Account row or null if not found
   */
  async findByUsername(username: string): Promise<AccountRow | null> {
    const rows = await this.db('accounts')
      .where({ username })
      .limit(1);

    return this.mapRow(rows[0]);
  }

  /**
   * Find account by email.
   *
   * @param email - Account email
   * @returns Account row or null if not found
   */
  async findByEmail(email: string): Promise<AccountRow | null> {
    const rows = await this.db('accounts')
      .where({ email })
      .limit(1);

    return this.mapRow(rows[0]);
  }

  /**
   * Create a new account.
   *
   * @param data - Account data (excluding id, timestamps)
   * @returns New account ID
   */
  async create(data: AccountCreateData): Promise<number> {
    const [row] = await this.db('accounts')
      .insert({
        ...data,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning('id');

    return row.id;
  }

  /**
   * Update account password hash.
   *
   * @param id - Account ID
   * @param passwordHash - New password hash
   */
  async updatePassword(id: number, passwordHash: string): Promise<void> {
    await this.db('accounts')
      .where({ id })
      .update({
        password_hash: passwordHash,
        updated_at: new Date(),
      });
  }

  /**
   * Update account fields.
   *
   * @param id - Account ID
   * @param data - Fields to update
   */
  async update(id: number, data: AccountUpdateData): Promise<void> {
    await this.db('accounts')
      .where({ id })
      .update({
        ...data,
        updated_at: new Date(),
      });
  }

  /**
   * Set account banned status.
   *
   * @param id - Account ID
   * @param banned - Ban status
   * @param bannedUntil - Optional ban expiration date
   */
  async setBanStatus(
    id: number,
    banned: boolean,
    bannedUntil?: Date
  ): Promise<void> {
    await this.db('accounts')
      .where({ id })
      .update({
        banned,
        banned_until: bannedUntil || null,
        updated_at: new Date(),
      });
  }

  /**
   * Delete an account.
   *
   * This will cascade to delete all associated characters.
   *
   * @param id - Account ID
   */
  async delete(id: number): Promise<void> {
    await this.db('accounts')
      .where({ id })
      .del();
  }

  /**
   * Check if username exists.
   *
   * @param username - Username to check
   * @returns True if username exists
   */
  async usernameExists(username: string): Promise<boolean> {
    const count = await this.db('accounts')
      .where({ username })
      .count('id as count')
      .first();

    return (count?.count as number) > 0;
  }

  /**
   * Check if email exists.
   *
   * @param email - Email to check
   * @returns True if email exists
   */
  async emailExists(email: string): Promise<boolean> {
    const count = await this.db('accounts')
      .where({ email })
      .count('id as count')
      .first();

    return (count?.count as number) > 0;
  }
}

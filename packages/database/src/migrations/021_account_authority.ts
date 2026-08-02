import type { Knex } from '../types';

/**
 * Replace the binary `accounts.gm` boolean with a tiered `authority` column.
 *
 * `authority` holds the ASCII code of the v19 `AUTH_*` letter (`_Common/
 * authorization.h`): GENERAL 'F' (0x46) .. ADMINISTRATOR 'P' (0x50). JOIN reads
 * it verbatim into `m_bAuthorization`; each `/cmd` gates on its own required
 * tier. Backfill maps the old boolean to the extremes (gm -> ADMINISTRATOR,
 * else GENERAL), preserving existing access before an operator assigns finer
 * tiers. See `packages/entities/src/constants/authority.ts`.
 */

const AUTH_GENERAL = 0x46;
const AUTH_ADMINISTRATOR = 0x50;

export async function up(db: Knex): Promise<void> {
  const hasAuthority = await db.schema.hasColumn('accounts', 'authority');
  if (!hasAuthority) {
    await db.schema.alterTable('accounts', (t) => {
      t.integer('authority').notNullable().defaultTo(AUTH_GENERAL);
    });
  }
  if (await db.schema.hasColumn('accounts', 'gm')) {
    await db('accounts').where('gm', true).update({ authority: AUTH_ADMINISTRATOR });
    await db.schema.alterTable('accounts', (t) => {
      t.dropColumn('gm');
    });
  }
}

export async function down(db: Knex): Promise<void> {
  if (!(await db.schema.hasColumn('accounts', 'gm'))) {
    await db.schema.alterTable('accounts', (t) => {
      t.boolean('gm').defaultTo(false);
    });
  }
  if (await db.schema.hasColumn('accounts', 'authority')) {
    await db('accounts').where('authority', '>=', AUTH_ADMINISTRATOR).update({ gm: true });
    await db.schema.alterTable('accounts', (t) => {
      t.dropColumn('authority');
    });
  }
}

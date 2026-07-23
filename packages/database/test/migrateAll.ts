import type { Knex } from '../src/types';
import { up as up001 } from '../src/migrations/001_initial';
import { up as up002 } from '../src/migrations/002_quests';
import { up as up003 } from '../src/migrations/003_character_gold';
import { up as up004 } from '../src/migrations/004_bank_tab';
import { up as up005 } from '../src/migrations/005_skills_slot';
import { up as up006 } from '../src/migrations/006_bank_pass';
import { up as up007 } from '../src/migrations/007_character_angle';
import { up as up008 } from '../src/migrations/008_normalize_containers';

/**
 * Apply the full migration chain 001..008 in order to an in-memory test DB.
 *
 * Migration 008 (container normalization) renames `inventory`/`bank` to
 * `*_item` and creates the new container tables, and it can only run after the
 * columns it drops (`characters.gold`, `characters.bank_pass`,
 * `accounts.bank_gold`) have been added by 003/004/006 -- so any test that
 * touches the inventory/bank repos must run the whole chain, not a subset.
 */
export async function applyAllMigrations(db: Knex): Promise<void> {
  await up001(db);
  await up002(db);
  await up003(db);
  await up004(db);
  await up005(db);
  await up006(db);
  await up007(db);
  await up008(db);
}

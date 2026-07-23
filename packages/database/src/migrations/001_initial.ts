import type { Knex } from '../types';

/**
 * Initial database schema.
 *
 * Creates three core tables:
 * - accounts: User authentication
 * - characters: Player characters
 * - inventory: Character inventory items
 *
 * @param db - Knex instance
 */
export async function up(db: Knex): Promise<void> {
  // Accounts table - stores user credentials
  await db.schema.createTable('accounts', (table: any) => {
    table.increments('id').primary();
    table.string('username', 32).notNullable().unique();
    table.string('password_hash', 255).notNullable();
    table.string('email', 255).nullable();
    table.boolean('gm').defaultTo(false);
    table.boolean('banned').defaultTo(false);
    table.timestamp('banned_until').nullable();
    table.timestamps(true, true);
  });

  // Characters table - stores player characters
  await db.schema.createTable('characters', (table: any) => {
    table.increments('id').primary();
    table.integer('account_id').unsigned().notNullable()
      .references('id').inTable('accounts').onDelete('CASCADE');
    table.string('name', 16).notNullable();
    table.integer('slot').unsigned().notNullable();
    table.integer('class').unsigned().defaultTo(0); // Job ID
    table.integer('gender').unsigned().defaultTo(0); // 0 = male, 1 = female
    table.integer('hair_style').unsigned().defaultTo(1);
    table.integer('hair_color').unsigned().defaultTo(1);
    table.integer('face_style').unsigned().defaultTo(1);
    table.integer('skin_color').unsigned().defaultTo(1);
    table.integer('level').unsigned().defaultTo(1);
    table.bigInteger('exp').unsigned().defaultTo(0);
    table.integer('hp').unsigned().defaultTo(100);
    table.integer('mp').unsigned().defaultTo(50);
    table.integer('max_hp').unsigned().defaultTo(100);
    table.integer('max_mp').unsigned().defaultTo(50);
    table.integer('strength').unsigned().defaultTo(15);
    table.integer('stamina').unsigned().defaultTo(15);
    table.integer('dexterity').unsigned().defaultTo(15);
    table.integer('intelligence').unsigned().defaultTo(15);
    // Position
    table.float('x').defaultTo(0);
    table.float('y').defaultTo(0);
    table.float('z').defaultTo(0);
    // World/Zone
    table.string('world_id', 32).defaultTo('world1');
    table.integer('zone_id').unsigned().defaultTo(1);
    timestamps(table);

    table.unique(['account_id', 'slot']);
    table.unique(['name']);
  });

  // Inventory table - stores character inventory items
  await db.schema.createTable('inventory', (table: any) => {
    table.increments('id').primary();
    table.integer('character_id').unsigned().notNullable()
      .references('id').inTable('characters').onDelete('CASCADE');
    table.integer('slot').unsigned().notNullable();
    table.integer('item_id').unsigned().notNullable();
    table.integer('quantity').unsigned().defaultTo(1);
    table.integer('flags').unsigned().defaultTo(0); // Elemental, rarity, etc.
    table.integer('durability').unsigned().defaultTo(-1); // -1 = indestructible
    table.integer('refine').unsigned().defaultTo(0);
    table.text('stats').nullable(); // JSON string for awakened stats
    timestamps(table);

    table.unique(['character_id', 'slot']);
  });

  // Bank table - shared bank storage across characters on same account
  await db.schema.createTable('bank', (table: any) => {
    table.increments('id').primary();
    table.integer('account_id').unsigned().notNullable()
      .references('id').inTable('accounts').onDelete('CASCADE');
    table.integer('slot').unsigned().notNullable();
    table.integer('item_id').unsigned().notNullable();
    table.integer('quantity').unsigned().defaultTo(1);
    table.integer('flags').unsigned().defaultTo(0);
    table.integer('durability').unsigned().defaultTo(-1);
    table.integer('refine').unsigned().defaultTo(0);
    table.text('stats').nullable();
    timestamps(table);

    table.unique(['account_id', 'slot']);
  });

  // Skills table - character learned skills
  await db.schema.createTable('skills', (table: any) => {
    table.increments('id').primary();
    table.integer('character_id').unsigned().notNullable()
      .references('id').inTable('characters').onDelete('CASCADE');
    table.integer('skill_id').unsigned().notNullable();
    table.integer('level').unsigned().defaultTo(1);
    timestamps(table);

    table.unique(['character_id', 'skill_id']);
  });

  // Quick slots table - UI quick bar shortcuts
  await db.schema.createTable('quick_slots', (table: any) => {
    table.increments('id').primary();
    table.integer('character_id').unsigned().notNullable()
      .references('id').inTable('characters').onDelete('CASCADE');
    table.integer('slot').unsigned().notNullable();
    table.integer('type').unsigned().notNullable(); // 0 = item, 1 = skill
    table.integer('target_id').unsigned().notNullable(); // item_id or skill_id
    timestamps(table);

    table.unique(['character_id', 'slot']);
  });
}

/**
 * Drops all tables created in up().
 *
 * @param db - Knex instance
 */
export async function down(db: Knex): Promise<void> {
  await db.schema.dropTableIfExists('quick_slots');
  await db.schema.dropTableIfExists('skills');
  await db.schema.dropTableIfExists('bank');
  await db.schema.dropTableIfExists('inventory');
  await db.schema.dropTableIfExists('characters');
  await db.schema.dropTableIfExists('accounts');
}

/**
 * Helper to add timestamp columns.
 *
 * @param table - Knex table builder
 */
function timestamps(table: any): void {
  table.timestamps(true, true);
}

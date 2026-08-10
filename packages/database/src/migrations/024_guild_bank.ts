import type { Knex } from '../types';

/**
 * Guild bank persistence -- `CItemContainer<CItemElem> m_GuildBank`
 * (`_Common/guild.h:305`, `MAX_GUILDBANK = 42` at `guild.h:30`), mirroring the
 * CoreServer row written by `GUILD_BANK_STR` (`_Database/DbManager.cpp:3276`
 * insert, `:3515` update).
 *
 * Two tables, per rule 11 (container metadata and contents are separate; a 1:N
 * collection never becomes a JSON column or a packed string on the owner):
 *   `guild_bank`      -- one row per guild, the container's own attributes
 *   `guild_bank_item` -- the contents, one row per occupied slot
 *
 * DIVERGENCE FROM C++ (deliberate). Vanilla writes the entire 42-slot bank as
 * three packed strings in ONE row -- `icsGuildBank.szIndex` (`m_apIndex`),
 * `szObjIndex` (`m_dwObjIndex`), `szItem` (the serialized elems), plus
 * `szExt`/`szPiercing`/`szPet` -- because CoreServer's flat-file-backed SQL has
 * no per-slot table. That is a storage optimization, not a schema design: it
 * makes a single slot unqueryable, forces a full re-serialize for every deposit,
 * and needs an application-side parse on load. The relational equivalent is one
 * row per slot, which is what this migration creates.
 *
 * The bank's PENYA pool is deliberately NOT here -- it lives on `guild.gold`
 * (`CGuild::m_nGoldGuild`, migration 023). In C++ that single field is both the
 * bank balance (`GUILD_BANK_STR` writes `nGoldGuild` alongside the item strings)
 * AND the guild level-up currency (`CGuild::m_nLevel` upgrades spend it), so
 * splitting it into a `guild_bank.gold` column would desync levelling from
 * withdrawals -- two writers, one balance, no source of truth.
 *
 * Item instance columns mirror `bank_item` (001 + 008) so both banks store items
 * identically: `flags`, `durability`, `stats`. `element` / `element_level`
 * (migration 012) are included even though `bank_item` lacks them -- 012 skipped
 * the personal bank as a `ponytail:` note, and a guild bank that dropped an
 * item's element on deposit would silently destroy an enchant.
 *
 * @param db - Knex instance
 */
export async function up(db: Knex): Promise<void> {
  await db.schema.createTable('guild_bank', (table) => {
    // One row per guild. The id is the guild's, not its own sequence: the
    // container cannot exist without its owner and is never addressed alone.
    table.integer('guild_id').unsigned().primary()
      .references('id').inTable('guild').onDelete('CASCADE');
    // Last mutation, epoch ms -- what `touch()` writes. Rule 11's "container
    // rows are lazy": no row exists until the bank is first used.
    table.bigInteger('updated_at_ms').notNullable();
  });

  await db.schema.createTable('guild_bank_item', (table) => {
    table.increments('id').primary();
    table.integer('guild_id').unsigned().notNullable()
      .references('id').inTable('guild').onDelete('CASCADE');
    // 0 .. MAX_GUILDBANK - 1 (42 slots, `guild.h:30`).
    table.integer('slot').notNullable();
    // `CItemElem::m_dwItemId` -- the propItem row, not the instance.
    table.integer('item_id').unsigned().notNullable();
    // `m_nItemNum`. Named `count` (not `bank_item`'s `quantity`) per the spec
    // for this table; see the report note on the naming divergence.
    table.integer('count').notNullable().defaultTo(1);
    // `CItemElem::m_dwObjId` -- the STABLE objid the client addresses items by
    // (see memory `v19-updateitem-nid-is-objid-not-slot`). Nullable: legacy /
    // hydrated rows may predate an assigned objid, and C++ itself rebuilds
    // `m_dwObjIndex` on load.
    table.integer('objid').unsigned().nullable();
    // `m_nResistAbilityOption` siblings -- instance upgrade state.
    table.integer('refine').notNullable().defaultTo(0);
    // SAI79::ePropType element byte (0..5) + its level (0..20); migration 012.
    table.integer('element').notNullable().defaultTo(0);
    table.integer('element_level').notNullable().defaultTo(0);
    // Mirrors `bank_item` (001): `m_dwFlag`, `m_nHitPoint` (-1 = indestructible),
    // and the awakened-stat JSON blob. Present so a deposit round-trips an item
    // without losing state the personal bank keeps.
    table.integer('flags').notNullable().defaultTo(0);
    table.integer('durability').notNullable().defaultTo(-1);
    table.text('stats').nullable();
    // `idLogPlayer` in `GUILD_BANK_STR` -- who touched the bank, for the log.
    // Not an FK: the depositor may later be deleted, and the log entry must
    // outlive them (same reasoning as `guild.master_id` in 023).
    table.integer('deposited_by').unsigned().nullable();
    table.bigInteger('deposited_at_ms').notNullable();
    // One item per slot -- the container is positional (`m_apIndex`).
    table.unique(['guild_id', 'slot']);
    table.index(['guild_id']);
  });
}

export async function down(db: Knex): Promise<void> {
  await db.schema.dropTableIfExists('guild_bank_item');
  await db.schema.dropTableIfExists('guild_bank');
}

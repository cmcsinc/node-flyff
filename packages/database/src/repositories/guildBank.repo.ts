import type { Knex } from '../types';

/** One row of `guild_bank_item` (migration `024`) -- one occupied slot. */
export interface GuildBankItemRow {
  readonly id: number;
  readonly guild_id: number;
  readonly slot: number;
  readonly item_id: number;
  readonly count: number;
  readonly objid: number | null;
  readonly refine: number;
  readonly element: number;
  readonly element_level: number;
  readonly flags: number;
  readonly durability: number;
  readonly stats: string | null;
  readonly deposited_by: number | null;
  readonly deposited_at_ms: number;
}

/** One occupied slot in camelCase, as a `GuildBank` container holds it. */
export interface GuildBankItem {
  /** 0 .. MAX_GUILDBANK - 1 (42, `_Common/guild.h:30`). */
  readonly slot: number;
  /** `CItemElem::m_dwItemId` -- the propItem row. */
  readonly itemId: number;
  /** `m_nItemNum`. */
  readonly count: number;
  /** `CItemElem::m_dwObjId` -- the stable objid the client addresses. */
  readonly objid: number | null;
  readonly refine: number;
  readonly element: number;
  readonly elementLevel: number;
  readonly flags: number;
  /** `m_nHitPoint`; -1 = indestructible. */
  readonly durability: number;
  /** Awakened-stat JSON blob, or null. */
  readonly stats: string | null;
  /** Character who deposited (`idLogPlayer`), or null. */
  readonly depositedBy: number | null;
  readonly depositedAtMs: number;
}

/** What a caller supplies for a slot -- everything but the slot and timestamp. */
export interface GuildBankItemData {
  readonly itemId: number;
  readonly count?: number;
  readonly objid?: number | null;
  readonly refine?: number;
  readonly element?: number;
  readonly elementLevel?: number;
  readonly flags?: number;
  readonly durability?: number;
  readonly stats?: string | null;
  readonly depositedBy?: number | null;
}

/**
 * GuildBankRepository -- the `guild_bank` + `guild_bank_item` tables
 * (migration `024`).
 *
 * Ported from `CItemContainer<CItemElem> m_GuildBank` (`_Common/guild.h:305`)
 * and the `GUILD_BANK_STR` row in `_Database/DbManager.cpp:3276,3515`. C++
 * packs all 42 slots into three strings in one row; this repo stores one row
 * per occupied slot (rule 11) -- see the migration doc comment for why.
 *
 * The bank's penya pool is NOT here: it is `guild.gold`
 * (`CGuild::m_nGoldGuild`) via {@link GuildRepository.update}, because C++ uses
 * that one field as both the bank balance and the level-up currency.
 *
 * Every mutation is write-through (matching `GuildRepository`) so a hard kill
 * cannot roll a deposit back into a dupe.
 *
 * @module database/repositories/guildBank
 */
export class GuildBankRepository {
  constructor(private readonly db: Knex) {}

  /** Occupied slots for one guild, ordered by slot. */
  async load(guildId: number): Promise<GuildBankItem[]> {
    const rows: GuildBankItemRow[] = await this.db('guild_bank_item')
      .where({ guild_id: guildId })
      .orderBy('slot', 'asc')
      .select('*');
    return rows.map(toItem);
  }

  /**
   * Every guild's bank, guild id -> slots -- the world-boot hydrate. One query,
   * not one per guild: hydrate runs before the listener opens, and N queries
   * over a populated guild table is the shape that makes boot crawl.
   */
  async loadAll(): Promise<Map<number, GuildBankItem[]>> {
    const rows: GuildBankItemRow[] = await this.db('guild_bank_item')
      .orderBy([{ column: 'guild_id', order: 'asc' }, { column: 'slot', order: 'asc' }])
      .select('*');
    const byGuild = new Map<number, GuildBankItem[]>();
    for (const r of rows) {
      const list = byGuild.get(r.guild_id) ?? [];
      list.push(toItem(r));
      byGuild.set(r.guild_id, list);
    }
    return byGuild;
  }

  /**
   * Upsert one slot (absolute new contents -- a deposit, a stack change, or an
   * overwrite after the slot was cleared in memory). Also touches the container
   * metadata row so `updated_at_ms` tracks the last mutation.
   */
  async setSlot(
    guildId: number, slot: number, item: GuildBankItemData, nowMs = Date.now(),
  ): Promise<void> {
    const values = {
      item_id: item.itemId,
      count: item.count ?? 1,
      objid: item.objid ?? null,
      refine: item.refine ?? 0,
      element: item.element ?? 0,
      element_level: item.elementLevel ?? 0,
      flags: item.flags ?? 0,
      durability: item.durability ?? -1,
      stats: item.stats ?? null,
      deposited_by: item.depositedBy ?? null,
      deposited_at_ms: nowMs,
    };
    await this.db('guild_bank_item')
      .insert({ guild_id: guildId, slot, ...values })
      .onConflict(['guild_id', 'slot'])
      .merge(values);
    await this.touch(guildId, nowMs);
  }

  /** Empty one slot (withdraw, or the source half of a move). */
  async clearSlot(guildId: number, slot: number): Promise<void> {
    await this.db('guild_bank_item').where({ guild_id: guildId, slot }).delete();
    await this.touch(guildId);
  }

  /**
   * Swap two slots in one transaction. Handles both occupied (a true swap) and
   * an empty destination (a plain relocation). Both writes are one transaction
   * because a half-applied swap either duplicates or destroys an item -- the
   * `UNIQUE(guild_id, slot)` constraint would otherwise reject the first update
   * on a both-occupied swap and leave the container inconsistent.
   */
  async moveSlot(guildId: number, src: number, dst: number): Promise<void> {
    if (src === dst) return;
    await this.db.transaction(async (trx: Knex) => {
      const rows: GuildBankItemRow[] = await trx('guild_bank_item')
        .where({ guild_id: guildId })
        .whereIn('slot', [src, dst])
        .select('*');
      const srcRow = rows.find((r) => r.slot === src);
      const dstRow = rows.find((r) => r.slot === dst);
      if (!srcRow && !dstRow) return;
      // Park the source out of the unique index first, so the destination can
      // take slot `src` without colliding.
      if (srcRow) {
        await trx('guild_bank_item').where({ id: srcRow.id }).update({ slot: -1 });
      }
      if (dstRow) {
        await trx('guild_bank_item').where({ id: dstRow.id }).update({ slot: src });
      }
      if (srcRow) {
        await trx('guild_bank_item').where({ id: srcRow.id }).update({ slot: dst });
      }
    });
    await this.touch(guildId);
  }

  /**
   * Upsert the container metadata row. Lazy per rule 11: no row is fabricated
   * at guild-create time, it appears on the bank's first mutation.
   */
  async touch(guildId: number, nowMs = Date.now()): Promise<void> {
    await this.db('guild_bank')
      .insert({ guild_id: guildId, updated_at_ms: nowMs })
      .onConflict('guild_id')
      .merge({ updated_at_ms: nowMs });
  }
}

function toItem(r: GuildBankItemRow): GuildBankItem {
  return {
    slot: r.slot,
    itemId: r.item_id,
    count: r.count,
    objid: r.objid === null ? null : Number(r.objid),
    refine: r.refine,
    element: r.element,
    elementLevel: r.element_level,
    flags: r.flags,
    durability: r.durability,
    stats: r.stats,
    depositedBy: r.deposited_by === null ? null : Number(r.deposited_by),
    depositedAtMs: Number(r.deposited_at_ms),
  };
}

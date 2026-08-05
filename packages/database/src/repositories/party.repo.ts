import type { Knex } from '../types';

/** One row of `parties` (migration `022`) -- a party's own attributes. */
export interface PartyRow {
  readonly id: number;
  readonly kind_troup: number;
  readonly name: string;
  readonly level: number;
  readonly exp: number;
  readonly point: number;
  readonly exp_mode: number;
  readonly item_mode: number;
  readonly last_item_getter_id: number;
  readonly created_at_ms: number;
}

/** One row of `party_member` -- a roster entry. `slot` 0 is the leader. */
export interface PartyMemberRow {
  readonly id: number;
  readonly party_id: number;
  readonly character_id: number;
  readonly slot: number;
  readonly joined_at_ms: number;
}

/** A party plus its roster, leader first. */
export interface PartyWithMembers {
  readonly id: number;
  readonly kindTroup: number;
  readonly name: string;
  readonly level: number;
  readonly exp: number;
  readonly point: number;
  readonly expMode: number;
  readonly itemMode: number;
  readonly lastItemGetterId: number;
  /** Character ids ordered by `slot` -- index 0 is the leader. */
  readonly members: number[];
}

/** Mutable party fields (everything but `id` and `created_at_ms`). */
export interface PartyUpdateData {
  kind_troup?: number;
  name?: string;
  level?: number;
  exp?: number;
  point?: number;
  exp_mode?: number;
  item_mode?: number;
  last_item_getter_id?: number;
}

/**
 * PartyRepository -- the `parties` + `party_member` tables (migration `022`).
 *
 * C++ has no equivalent: vanilla keeps rosters in CoreServer RAM and persists
 * only `characters.m_idparty`, so a CoreServer restart destroys every party.
 * This repo is the durable-party divergence documented in the migration.
 *
 * Every mutation is write-through (matching the friend/campus repos) so a hard
 * kill cannot roll a roster back. {@link replaceMembers} rewrites the whole
 * roster in one transaction because `slot` is positional -- a partial write
 * would leave two members claiming slot 0.
 *
 * @module database/repositories/party
 */
export class PartyRepository {
  constructor(private readonly db: Knex) {}

  /** Every party with its roster -- the world-boot hydrate. */
  async loadAll(): Promise<PartyWithMembers[]> {
    const parties: PartyRow[] = await this.db('parties').select('*');
    const members: PartyMemberRow[] = await this.db('party_member')
      .orderBy('slot', 'asc')
      .select('*');
    const byParty = new Map<number, number[]>();
    for (const m of members) {
      const list = byParty.get(m.party_id) ?? [];
      list.push(m.character_id);
      byParty.set(m.party_id, list);
    }
    return parties.map((p) => toWithMembers(p, byParty.get(p.id) ?? []));
  }

  /** Highest party id in use, or 0 when there are none (id-counter seed). */
  async maxId(): Promise<number> {
    const row: { m: number | null } | undefined = await this.db('parties')
      .max({ m: 'id' })
      .first();
    return Number(row?.m ?? 0);
  }

  /** Insert a party with its initial roster in one transaction. */
  async create(party: PartyWithMembers, nowMs = Date.now()): Promise<void> {
    await this.db.transaction(async (trx: Knex) => {
      await trx('parties').insert({
        id: party.id,
        kind_troup: party.kindTroup,
        name: party.name,
        level: party.level,
        exp: party.exp,
        point: party.point,
        exp_mode: party.expMode,
        item_mode: party.itemMode,
        last_item_getter_id: party.lastItemGetterId,
        created_at_ms: nowMs,
      });
      await insertMembers(trx, party.id, party.members, nowMs);
    });
  }

  /** Patch mutable party fields. A no-op for an empty patch. */
  async update(partyId: number, data: PartyUpdateData): Promise<void> {
    if (Object.keys(data).length === 0) return;
    await this.db('parties').where({ id: partyId }).update(data);
  }

  /**
   * Rewrite the roster wholesale. `slot` is positional and the leader must be
   * slot 0, so delete-then-insert inside one transaction is the only safe shape
   * -- an in-place slot shuffle would transiently violate `UNIQUE(slot)`
   * semantics and could leave two leaders if it failed midway.
   */
  async replaceMembers(partyId: number, members: number[], nowMs = Date.now()): Promise<void> {
    await this.db.transaction(async (trx: Knex) => {
      await trx('party_member').where({ party_id: partyId }).delete();
      await insertMembers(trx, partyId, members, nowMs);
    });
  }

  /** Drop the party; `party_member` rows cascade. */
  async remove(partyId: number): Promise<void> {
    await this.db('parties').where({ id: partyId }).delete();
  }
}

async function insertMembers(
  trx: Knex, partyId: number, members: number[], nowMs: number,
): Promise<void> {
  if (members.length === 0) return;
  await trx('party_member').insert(members.map((characterId, slot) => ({
    party_id: partyId, character_id: characterId, slot, joined_at_ms: nowMs,
  })));
}

function toWithMembers(p: PartyRow, members: number[]): PartyWithMembers {
  return {
    id: p.id,
    kindTroup: p.kind_troup,
    name: p.name,
    level: p.level,
    exp: p.exp,
    point: p.point,
    expMode: p.exp_mode,
    itemMode: p.item_mode,
    lastItemGetterId: p.last_item_getter_id,
    members,
  };
}

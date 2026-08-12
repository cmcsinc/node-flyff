import type { Knex } from '../types';

/** `MAX_PUPIL_NUM` (`_Common/Campus.h:17`) -- hard pupil ceiling per campus. */
export const MAX_PUPIL_NUM = 3;

/** One row of `campus` (migration `020`) -- C++ `CCampus`. */
export interface CampusRow {
  readonly id: number;
  readonly master_id: number;
  readonly created_at_ms: number;
}

/** One row of `campus_member` -- C++ `CCampusMember`. */
export interface CampusMemberRow {
  readonly id: number;
  readonly campus_id: number;
  readonly character_id: number;
  /** `CAMPUS_MASTER` (1) or `CAMPUS_PUPIL` (2). */
  readonly member_level: number;
  readonly joined_at_ms: number;
}

/** A campus plus its members, the shape `CCampus::Serialize` needs. */
export interface CampusWithMembers {
  readonly id: number;
  readonly masterId: number;
  readonly members: readonly { characterId: number; memberLevel: number }[];
}

/**
 * CampusRepository -- `campus` + `campus_member` + the two `characters` columns.
 *
 * C++ has no world-server equivalent: campuses live on the DB server
 * (`databaseserver/dptrans.cpp:2283-2300`) and the world only replays broadcasts.
 * Collapsing the tiers puts the writes here, but the operations map 1:1 onto the
 * C++ requests: {@link create} = `SendAddCampusMember`, {@link removeMember` /
 * {@link dissolve} = `SendRemoveCampusMember`, {@link addPoints} =
 * `SendUpdateCampusPoint`.
 *
 * @module database/repositories/campus
 */
export class CampusRepository {
  constructor(private readonly db: Knex) {}

  /** Every campus with its members -- the boot-time `PACKETTYPE_CAMPUS_ALL` load. */
  async loadAll(): Promise<CampusWithMembers[]> {
    const campuses: CampusRow[] = await this.db('campus').select('*');
    const members: CampusMemberRow[] = await this.db('campus_member').select('*');
    const byCampus = new Map<number, { characterId: number; memberLevel: number }[]>();
    for (const m of members) {
      const list = byCampus.get(m.campus_id) ?? [];
      list.push({ characterId: m.character_id, memberLevel: m.member_level });
      byCampus.set(m.campus_id, list);
    }
    return campuses.map((c: CampusRow) => ({
      id: c.id, masterId: c.master_id, members: byCampus.get(c.id) ?? [],
    }));
  }

  /** The campus `characterId` belongs to, or `undefined`. */
  async findByCharacter(characterId: number): Promise<CampusWithMembers | undefined> {
    const row: CampusMemberRow | undefined = await this.db('campus_member')
      .where({ character_id: characterId }).first();
    if (!row) return undefined;
    return this.findById(row.campus_id);
  }

  /** One campus with its members. */
  async findById(campusId: number): Promise<CampusWithMembers | undefined> {
    const campus: CampusRow | undefined = await this.db('campus').where({ id: campusId }).first();
    if (!campus) return undefined;
    const members: CampusMemberRow[] = await this.db('campus_member')
      .where({ campus_id: campusId }).select('*');
    return {
      id: campus.id,
      masterId: campus.master_id,
      members: members.map((m: CampusMemberRow) => ({ characterId: m.character_id, memberLevel: m.member_level })),
    };
  }

  /**
   * Create a campus with a master + first pupil, or add the pupil to the
   * master's existing campus. Mirrors the DB server allocating the campus id
   * (`SendAddCampusMember` carries no id on the way in, but the broadcast back
   * does). Returns the campus id.
   */
  async addMember(
    masterId: number, pupilId: number,
    masterLevel: number, pupilLevel: number,
    nowMs = Date.now(),
  ): Promise<number> {
    return this.db.transaction(async (trx: Knex) => {
      const existing: CampusMemberRow | undefined = await trx('campus_member')
        .where({ character_id: masterId }).first();

      let campusId: number;
      if (existing) {
        campusId = existing.campus_id;
      } else {
        const [inserted] = await trx('campus')
          .insert({ master_id: masterId, created_at_ms: nowMs })
          .returning('id');
        campusId = Number(inserted);
        await trx('campus_member').insert({
          campus_id: campusId, character_id: masterId,
          member_level: masterLevel, joined_at_ms: nowMs,
        });
      }
      await trx('campus_member').insert({
        campus_id: campusId, character_id: pupilId,
        member_level: pupilLevel, joined_at_ms: nowMs,
      });
      return campusId;
    });
  }

  /** Drop one member. Does NOT dissolve -- the caller decides (see the service). */
  async removeMember(campusId: number, characterId: number): Promise<void> {
    await this.db('campus_member')
      .where({ campus_id: campusId, character_id: characterId })
      .del();
  }

  /** Delete the campus; `campus_member` rows cascade. */
  async dissolve(campusId: number): Promise<void> {
    await this.db('campus').where({ id: campusId }).del();
  }

  /** Remaining member count, for the "fewer than 2 left" dissolve rule. */
  async memberCount(campusId: number): Promise<number> {
    const row = await this.db('campus_member')
      .where({ campus_id: campusId })
      .count({ n: '*' })
      .first();
    return Number(row?.n ?? 0);
  }

  /** `CMover::m_nCampusPoint`. Can be negative -- see the migration doc. */
  async getPoints(characterId: number): Promise<number> {
    const row = await this.db('characters').where({ id: characterId }).first('campus_point');
    return Number(row?.campus_point ?? 0);
  }

  /**
   * Apply a signed delta and return the new balance.
   * `SendUpdateCampusPoint( id, nPoint, bAdd, chState )` -- `bAdd` FALSE means
   * subtract, which the caller expresses by passing a negative `delta`.
   */
  async addPoints(characterId: number, delta: number): Promise<number> {
    const current = await this.getPoints(characterId);
    const next = current + Math.trunc(delta);
    await this.db('characters').where({ id: characterId }).update({ campus_point: next });
    return next;
  }

  /** `CMover::m_dwTickCampus` -- the recovery cursor (0 = not started). */
  async getTick(characterId: number): Promise<number> {
    const row = await this.db('characters').where({ id: characterId }).first('campus_tick_ms');
    return Number(row?.campus_tick_ms ?? 0);
  }

  async setTick(characterId: number, tickMs: number): Promise<void> {
    await this.db('characters').where({ id: characterId }).update({ campus_tick_ms: tickMs });
  }
}

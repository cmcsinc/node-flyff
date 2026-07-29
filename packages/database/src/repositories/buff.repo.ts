import type { Knex } from '../types';

/**
 * One persisted active buff row (C++ `IBuff` → `SaveSkillInfluence` 4-int
 * shape: `{ type, id, level, total }`, with the 4th field re-purposed from
 * total duration to an absolute deadline — see migration `016`).
 */
export interface BuffRow {
  readonly id: number;
  readonly character_id: number;
  /** Buff source type (BUFF_ITEM=0, BUFF_SKILL=1). */
  readonly type: number;
  /** Skill id (wID) or item id (for BUFF_ITEM). */
  readonly skill_id: number;
  /** Skill level (dwLevel). 0 for item buffs. */
  readonly level: number;
  /** Absolute expiry timestamp in epoch ms (`inst + total`). */
  readonly expires_at_ms: number;
}

/**
 * Domain view returned by {@link BuffRepository.loadByCharacter} — strips the
 * DB surrogate key and FK, keeping only the fields the service layer needs.
 *
 * `remainingMs` is computed at load time from the persisted deadline, so a
 * buff's countdown survives relog instead of resetting to full. Rows already
 * lapsed are filtered out by the repository, so `remainingMs > 0` always.
 */
export interface PersistedBuff {
  readonly type: number;
  readonly skillId: number;
  readonly level: number;
  /** Milliseconds left until expiry, at the moment of load. */
  readonly remainingMs: number;
}

/**
 * Write-side view accepted by {@link BuffRepository.saveAll} — the caller passes
 * the absolute deadline it already tracks (`ActiveBuff.expiresAtMs`).
 */
export interface PersistableBuff {
  readonly type: number;
  readonly skillId: number;
  readonly level: number;
  /** Absolute expiry timestamp in epoch ms. */
  readonly expiresAtMs: number;
}

/**
 * Repository for per-character active timed buffs.
 *
 * All methods use Knex query builder (no raw SQL). Buffs are a 1:N collection
 * on characters — each buff is a row in `character_buffs`, not a JSON blob on
 * the character row (rule `11-database-normalization.md`).
 *
 * `saveAll` delete + reinserts in a transaction (same pattern as
 * {@link SkillRepository.saveAll}). At most ~28 rows/character
 * (`MAX_SKILL_BUFF`), so the approach is dev-scale friendly.
 */
export class BuffRepository {
  constructor(private db: Knex) {}

  /**
   * Load all still-active buffs for a character, converting the persisted
   * deadline into the remaining duration. Rows whose deadline already passed
   * are skipped (and left for the next `saveAll` to prune).
   *
   * @param characterId - Character ID
   * @param nowMs - Reference clock (defaults to `Date.now()`); injectable for tests
   * @returns Persisted buffs with `remainingMs > 0` (empty if none)
   */
  async loadByCharacter(characterId: number, nowMs = Date.now()): Promise<PersistedBuff[]> {
    const rows: BuffRow[] = await this.db('character_buffs')
      .where({ character_id: characterId });
    return rows
      .map((r) => ({
        type: r.type,
        skillId: r.skill_id,
        level: r.level,
        remainingMs: r.expires_at_ms - nowMs,
      }))
      .filter((b) => b.remainingMs > 0);
  }

  /**
   * Persist the full active-buff set for a character.
   *
   * Strategy: delete all existing rows, then insert the new set. At most
   * `MAX_SKILL_BUFF` (28) rows — cheap in a transaction. The unique
   * `(character_id, type, skill_id)` constraint catches duplicates.
   *
   * @param characterId - Character ID
   * @param buffs - Active buffs to persist (only BUFF_SKILL entries)
   */
  async saveAll(characterId: number, buffs: PersistableBuff[]): Promise<void> {
    await this.db.transaction(async (trx: any) => {
      await trx('character_buffs').where({ character_id: characterId }).del();
      if (buffs.length === 0) return;
      const rows = buffs.map((b) => ({
        character_id: characterId,
        type: b.type,
        skill_id: b.skillId,
        level: b.level,
        expires_at_ms: b.expiresAtMs,
      }));
      await trx('character_buffs').insert(rows);
    });
  }

  /**
   * Delete all active buffs for a character (cascade hook / death clear).
   *
   * @param characterId - Character ID
   */
  async deleteByCharacter(characterId: number): Promise<void> {
    await this.db('character_buffs')
      .where({ character_id: characterId })
      .del();
  }
}

import type { Knex } from '../types';

/**
 * One learned skill slot -- { slot: 0..44, skillId, level }.
 *
 * Mirrors the C++ `m_aJobSkill[45]` array entry (SKILL struct = DWORD dwSkill
 * + DWORD dwLevel). `skillId = 0xffffffff` (NULL_ID) denotes an empty slot;
 * this repo only stores learned (non-empty) slots.
 */
export interface LearnedSkill {
  /** Slot index 0-44 (0-2 vagrant, 3-22 expert, 23-42 pro, 43 master, 44 hero). */
  slot: number;
  /** Resolved SI_* skill id (defineSkill.h). */
  skillId: number;
  /** Learned skill level (1..dwExpertMax). */
  level: number;
}

/**
 * Database row interface for the `skills` table (post-migration 005).
 */
export interface SkillRow {
  id: number;
  character_id: number;
  slot: number;
  skill_id: number;
  level: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * Repository for per-character learned skills.
 *
 * All methods use Knex query builder (no raw SQL). The wire shape is a flat
 * 45-slot array, so `loadByCharacter` returns the learned subset and
 * `saveAll` delete + reinserts (dev-friendly; for production, switch to
 * per-slot upserts).
 */
export class SkillRepository {
  constructor(private db: Knex) {}

  /**
   * Coerce a raw row into a {@link LearnedSkill} view.
   * Drops rows outside the 0-44 slot range defensively.
   */
  private mapRow(row: SkillRow | undefined): LearnedSkill | null {
    if (!row) return null;
    if (row.slot < 0 || row.slot > 44) return null;
    return { slot: row.slot, skillId: row.skill_id, level: row.level };
  }

  /**
   * Load all learned skills for a character, ordered by slot.
   *
   * @param characterId - Character ID
   * @returns Learned skills (empty if none)
   */
  async loadByCharacter(characterId: number): Promise<LearnedSkill[]> {
    const rows: SkillRow[] = await this.db('skills')
      .where({ character_id: characterId })
      .orderBy('slot', 'asc');
    return rows
      .map((r) => this.mapRow(r))
      .filter((s): s is LearnedSkill => s !== null);
  }

  /**
   * Persist the full learned-skill set for a character.
   *
   * Strategy: delete all existing rows for the character, then insert the new
   * set. Cheap for dev-scale (<=45 slots/char); the unique `(character_id, slot)`
   * constraint catches any duplicate. Skips rows with NULL_ID skillId
   * defensively -- only learned slots belong in the table.
   *
   * @param characterId - Character ID
   * @param slots - Learned skills to persist
   */
  async saveAll(characterId: number, slots: LearnedSkill[]): Promise<void> {
    const valid = slots.filter((s) => s.skillId !== 0xffffffff && s.skillId > 0);
    await this.db.transaction(async (trx: any) => {
      await trx('skills').where({ character_id: characterId }).del();
      if (valid.length === 0) return;
      const now = new Date();
      const rows = valid.map((s) => ({
        character_id: characterId,
        slot: s.slot,
        skill_id: s.skillId,
        level: s.level,
        created_at: now,
        updated_at: now,
      }));
      await trx('skills').insert(rows);
    });
  }

  /**
   * Count learned skills for a character (any non-empty slot).
   *
   * @param characterId - Character ID
   * @returns Number of learned skills
   */
  async count(characterId: number): Promise<number> {
    const result = await this.db('skills')
      .where({ character_id: characterId })
      .count('id as count')
      .first();
    return (result?.count as number) || 0;
  }

  /**
   * Delete all learned skills for a character (cascade hook).
   *
   * @param characterId - Character ID
   */
  async clear(characterId: number): Promise<void> {
    await this.db('skills')
      .where({ character_id: characterId })
      .del();
  }
}

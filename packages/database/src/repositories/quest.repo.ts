import type { Knex } from '../types';

/** Active-quest row -- one per entry in the C++ `m_aQuest[]` array. */
export interface CharacterQuestRow {
  id: number;
  character_id: number;
  quest_id: number;
  state: number;            // QS_*
  time: number;             // m_wTime
  kill_npc_num_0: number;
  kill_npc_num_1: number;
  flags: number;            // QUEST_FLAG bitfield
  updated_at: Date;
}

/** A quest id in the completed list (`m_aCompleteQuest[]`). */
export interface CompletedQuestRow {
  character_id: number;
  quest_id: number;
  completed_at: Date;
}

/** Per-player quest state loaded on JOIN. */
export interface PlayerQuestState {
  active: CharacterQuestRow[];
  completed: number[];      // quest ids
  checked: number[];        // quest ids (slot order preserved)
}

/** In-memory active-quest payload used by the service to upsert. */
export type ActiveQuestPayload = Omit<CharacterQuestRow, 'id' | 'character_id' | 'updated_at'>;

/**
 * Repository for per-player quest state.
 *
 * All methods use the Knex query builder (no raw SQL). Mirrors the C++ per-mover
 * arrays (`_Common/Mover.h:702-709`). Quest definitions themselves live in
 * `@flyff/resources` -- this repo only holds player state + the audit log.
 */
export class QuestRepository {
  constructor(private db: Knex) {}

  /** Load full quest state for a character (active + completed + checked). */
  async loadState(characterId: number): Promise<PlayerQuestState> {
    const [active, completed, checked] = await Promise.all([
      this.db('character_quests').where({ character_id: characterId }) as Promise<CharacterQuestRow[]>,
      this.db('character_completed_quests')
        .where({ character_id: characterId }).orderBy('completed_at', 'asc') as Promise<CompletedQuestRow[]>,
      this.db('character_checked_quests')
        .where({ character_id: characterId }).orderBy('slot', 'asc') as Promise<{ quest_id: number }[]>,
    ]);
    return {
      active,
      completed: completed.map((r: CompletedQuestRow) => r.quest_id),
      checked: checked.map((r: { quest_id: number }) => r.quest_id),
    };
  }

  /** Insert or update one active quest (matches `CMover::SetQuest` upsert). */
  async upsertActive(characterId: number, q: ActiveQuestPayload): Promise<void> {
    await this.db('character_quests')
      .insert({ ...q, character_id: characterId, updated_at: new Date() })
      .onConflict(['character_id', 'quest_id']).merge();
  }

  /** Remove an active quest (`CMover::RemoveQuest`). */
  async removeActive(characterId: number, questId: number): Promise<void> {
    await this.db('character_quests').where({ character_id: characterId, quest_id: questId }).del();
  }

  /** Append to the completed list (idempotent). */
  async addCompleted(characterId: number, questId: number): Promise<void> {
    await this.db('character_completed_quests')
      .insert({ character_id: characterId, quest_id: questId, completed_at: new Date() })
      .onConflict(['character_id', 'quest_id']).ignore();
  }

  /** Remove from the completed list. */
  async removeCompleted(characterId: number, questId: number): Promise<void> {
    await this.db('character_completed_quests')
      .where({ character_id: characterId, quest_id: questId }).del();
  }

  /** Clear the entire completed list (`AddRemoveCompleteQuest`). */
  async clearCompleted(characterId: number): Promise<void> {
    await this.db('character_completed_quests').where({ character_id: characterId }).del();
  }

  /** Replace the checked-quest list (`AddCheckedQuest` full-replace). */
  async setChecked(characterId: number, questIds: number[]): Promise<void> {
    await this.db.transaction(async (trx: Knex) => {
      await trx('character_checked_quests').where({ character_id: characterId }).del();
      if (questIds.length === 0) return;
      const rows = questIds.map((quest_id, slot) => ({ character_id: characterId, quest_id, slot }));
      await trx('character_checked_quests').insert(rows);
    });
  }

  /** Audit row -- mirrors `CalluspLoggingQuest(playerId, questId, action)`. */
  async insertLog(characterId: number, questId: number, action: number): Promise<void> {
    await this.db('quest_log')
      .insert({ character_id: characterId, quest_id: questId, action, ts: new Date() });
  }
}
